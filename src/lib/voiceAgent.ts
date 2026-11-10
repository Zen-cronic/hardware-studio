import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { normalizeSpokenNumbers } from "../shared/spoken-numbers";

// Hold-to-talk speech input and spoken replies, built on the browser's own Web Speech APIs.
// No audio leaves the browser through this app, and no paid voice service is used.

export type VoicePhase = "idle" | "listening" | "finishing";

type Recognition = any;
export function recognitionConstructor(): (new () => Recognition) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function recognitionError(code: string) {
  if (code === "no-speech") return "No speech was detected. Hold to talk and try again, or type your instruction.";
  if (code === "network") return "Speech recognition could not reach its service. Check your connection or type your instruction.";
  if (code === "audio-capture") return "No microphone was available. Connect or enable an input device, or type your instruction.";
  if (code === "language-not-supported") return "English (US) speech recognition is unavailable in this browser. You can type your instruction.";
  if (code === "not-allowed" || code === "service-not-allowed") return "Microphone access was unavailable. Check your browser permission or type your instruction.";
  return "Voice input could not start. Try again or type your instruction.";
}

export interface HoldCallbacks {
  onListening: (active: boolean) => void;
  onSpeechStart: () => void;
  onInterim?: (text: string) => void;
  /** Called once with the whole utterance, before onListening(false). */
  onText: (text: string) => void;
  onError: (message: string) => void;
}
export interface HoldSession { release: () => void; cancel: () => void }

/**
 * Starts one press-and-hold utterance. Speech onset fires onSpeechStart exactly once, so the
 * caller can freeze what the pointer is on; release() ends capture and delivers the text.
 */
export function startHold(callbacks: HoldCallbacks): HoldSession | null {
  const C = recognitionConstructor();
  if (!C) { callbacks.onError("Voice input is not supported in this browser. You can type the same instruction."); return null; }
  let r: Recognition, done = false, released = false, speechStarted = false;
  const finals: string[] = [];
  let interim = "";
  const startSpeech = () => { if (speechStarted || done) return; speechStarted = true; callbacks.onSpeechStart(); };
  const finish = (error?: string) => {
    if (done) return;
    done = true;
    r.onstart = r.onend = r.onerror = r.onresult = r.onspeechstart = null;
    const text = (finals.join(" ") || (released ? interim : "")).replace(/\s+/g, " ").trim();
    if (error) callbacks.onError(recognitionError(error));
    else if (text) { startSpeech(); callbacks.onText(text); }
    else if (released) callbacks.onError("I didn't catch that. Hold to talk while you speak, or type your instruction.");
    callbacks.onListening(false);
  };
  try {
    r = new C();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onspeechstart = startSpeech;
    r.onresult = (event: any) => {
      const results = Array.from(event.results || []) as any[];
      finals.length = 0; interim = "";
      for (const result of results) {
        const transcript = String(result?.[0]?.transcript || "");
        if (result.isFinal === true) finals.push(transcript.trim()); else interim += transcript;
      }
      if (finals.length || interim.trim()) startSpeech();
      callbacks.onInterim?.((finals.join(" ") + " " + interim).trim());
    };
    r.onerror = (event: { error?: string }) => {
      const code = event.error || "";
      try { r.abort(); } catch { /* Already ended after the error. */ }
      // A release before any speech ends quietly; "aborted" is our own cancel.
      finish(code === "aborted" || (code === "no-speech" && released) ? undefined : code);
    };
    r.onend = () => finish();
    callbacks.onListening(true);
    r.start();
  } catch (error) {
    try { r?.abort(); } catch { /* A failed start need not have a session. */ }
    done = true;
    callbacks.onListening(false);
    callbacks.onError(recognitionError((error as Error)?.name === "NotAllowedError" ? "not-allowed" : ""));
    return null;
  }
  return {
    release: () => {
      if (done || released) return;
      released = true;
      try { r.stop(); } catch { finish(); }
    },
    cancel: () => {
      if (done) return;
      done = true;
      r.onstart = r.onend = r.onerror = r.onresult = r.onspeechstart = null;
      try { r.abort(); } catch { /* Already ended. */ }
      callbacks.onListening(false);
    },
  };
}

/** Plain spoken words for the symbols and short units the screen uses; applied only to speech. */
export function speakable(text: string) {
  return text
    .replace(/Ø\s*/g, "diameter ")
    .replace(/(\d)\s*mm\b/g, "$1 millimetres")
    .replace(/(\d)\s*cm\b/g, "$1 centimetres")
    .replace(/(\d)\s*kgf\b/g, "$1 kilogram-force")
    .replace(/(\d)\s*kg\b/g, "$1 kilograms")
    .replace(/(\d)\s*MPa\b/g, "$1 megapascals")
    .replace(/(\d)\s*N\b/g, "$1 newtons")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/→/g, " to ")
    .replace(/×/g, " by ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a reply into a few short sentences, each short enough to follow by ear. */
export function shortSentences(text: string, maxSentences = 3, maxChars = 140): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) { out.push(sentence); continue; }
    // A long sentence breaks at its clauses, then at a word boundary.
    let rest = sentence;
    while (rest.length > maxChars) {
      const clause = Math.max(rest.lastIndexOf(", ", maxChars), rest.lastIndexOf("; ", maxChars));
      const cut = clause > 40 ? clause + 1 : rest.lastIndexOf(" ", maxChars);
      const at = cut > 40 ? cut : maxChars;
      const piece = rest.slice(0, at).replace(/[,;]\s*$/, "").trim();
      out.push(/[.!?]$/.test(piece) ? piece : piece + ",");
      rest = rest.slice(at).replace(/^[,;\s]+/, "");
    }
    if (rest) out.push(rest);
  }
  return out.slice(0, maxSentences);
}

/** What the assistant says back for a proposal: its explanation, then any questions. */
export function replyLines(reply: { explanation?: string; questions?: string[] }): string[] {
  const lines = shortSentences(reply.explanation || "", 3);
  for (const question of reply.questions || []) lines.push(...shortSentences(question, 1));
  return lines.slice(0, 4);
}

export function speechSynthesisAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof (window as any).SpeechSynthesisUtterance === "function";
}

/** Speaks lines in order; returns a cancel function. Never throws. */
export function speakLines(lines: string[], events: { onStart?: () => void; onEnd?: () => void } = {}): () => void {
  if (!lines.length || !speechSynthesisAvailable()) { events.onEnd?.(); return () => {}; }
  const synth = window.speechSynthesis;
  let cancelled = false, remaining = lines.length, started = false;
  const end = () => { if (cancelled) return; cancelled = true; events.onEnd?.(); };
  try {
    synth.cancel();
    const voice = synth.getVoices().find(v => /^en(-|_)/i.test(v.lang) && /natural|enhanced|premium|google/i.test(v.name))
      || synth.getVoices().find(v => /^en(-|_)/i.test(v.lang));
    for (const line of lines) {
      const u = new SpeechSynthesisUtterance(speakable(line));
      u.lang = voice?.lang || "en-US";
      if (voice) u.voice = voice;
      u.rate = 1.03;
      u.onstart = () => { if (!started && !cancelled) { started = true; events.onStart?.(); } };
      u.onend = u.onerror = () => { remaining -= 1; if (remaining <= 0) end(); };
      synth.speak(u);
    }
  } catch { end(); }
  return () => { if (cancelled) return; cancelled = true; try { synth.cancel(); } catch { /* Nothing playing. */ } events.onEnd?.(); };
}

const MUTE_KEY = "hardware-voice-muted";
function storedMute() { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } }

/** True when Space should stay with the focused element instead of starting a hold. */
export function keepsSpace(element: Element | null) {
  if (!element || element === document.body || element === document.documentElement) return false;
  const html = element as HTMLElement;
  if (html.isContentEditable) return true;
  if (element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox'], [role='slider'], [role='spinbutton'], [role='dialog'], dialog")) return true;
  // A keyboard user on a control keeps Space for that control; a mouse-clicked control does not.
  if (element.matches("button, a[href], summary, [role='button'], [role='tab'], [role='checkbox'], [role='switch'], [role='menuitem'], [role='option']"))
    return (() => { try { return element.matches(":focus-visible"); } catch { return true; } })();
  return false;
}

export interface VoiceAgentOptions {
  /** No new hold can start while disabled; an active hold is cancelled. */
  disabled?: boolean;
  /** Space starts a hold anywhere on the page while true (the studio's Design view). */
  spaceToTalk?: boolean;
  onSpeechStart: () => void;
  onText: (text: string) => void;
  onError: (message: string) => void;
  onListeningChange?: (active: boolean) => void;
  /** A reply to speak once: a new key speaks its lines if the last request was spoken. */
  reply?: { key: string; lines: string[] } | null;
}

export interface VoiceAgent {
  phase: VoicePhase;
  transcript: string;
  supported: boolean;
  muted: boolean;
  toggleMute: () => void;
  speaking: boolean;
  /** Begins a hold (Space down, mic pointer down). */
  press: () => void;
  /** Ends the hold and sends what was heard. */
  release: () => void;
  /** Marks the next reply as an answer to speech (for other voice controls). */
  expectReply: () => void;
  /** Speaks lines now unless muted (for results that arrive later, such as a check). */
  say: (lines: string[]) => void;
  /** Props for a press-and-hold mic control. */
  holdProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onContextMenu: (event: { preventDefault: () => void }) => void;
  };
}

export function useVoiceAgent(options: VoiceAgentOptions): VoiceAgent {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [muted, setMuted] = useState(storedMute);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const latest = useRef(options); latest.current = options;
  const session = useRef<HoldSession | null>(null);
  const awaitingReply = useRef(false);
  const stopSpeaking = useRef<(() => void) | null>(null);
  useEffect(() => { setSupported(!!recognitionConstructor()); }, []);

  const press = useCallback(() => {
    if (session.current || latest.current.disabled) return;
    stopSpeaking.current?.();
    setTranscript("");
    const started = startHold({
      onListening: active => {
        if (!active) { session.current = null; setPhase("idle"); }
        else setPhase("listening");
        latest.current.onListeningChange?.(active);
      },
      onSpeechStart: () => latest.current.onSpeechStart(),
      onInterim: text => setTranscript(text),
      // "Six millimetres" reaches the request as "6 mm", which the local rules can read.
      onText: text => { const words = normalizeSpokenNumbers(text); setTranscript(words); awaitingReply.current = true; latest.current.onText(words); },
      onError: message => latest.current.onError(message),
    });
    session.current = started;
  }, []);
  const release = useCallback(() => {
    if (!session.current) return;
    setPhase(current => current === "listening" ? "finishing" : current);
    session.current.release();
  }, []);
  useEffect(() => { if (options.disabled && session.current) { session.current.cancel(); session.current = null; } }, [options.disabled]);
  useEffect(() => () => { session.current?.cancel(); session.current = null; stopSpeaking.current?.(); }, []);

  // Hold Space anywhere; text fields and keyboard-focused controls keep their own Space.
  useEffect(() => {
    if (!options.spaceToTalk) return;
    let holding = false;
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (holding) { event.preventDefault(); return; }
      if (event.repeat || keepsSpace(document.activeElement) || keepsSpace(event.target as Element)) return;
      if (latest.current.disabled) return;
      event.preventDefault();
      holding = true;
      press();
    };
    const up = (event: KeyboardEvent) => {
      if (!holding || (event.code !== "Space" && event.key !== " ")) return;
      event.preventDefault();
      holding = false;
      release();
    };
    const blur = () => { if (holding) { holding = false; release(); } };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); };
  }, [options.spaceToTalk, press, release]);

  // Speak a new reply once, only when it answers something said aloud.
  const replyKey = options.reply?.key;
  useEffect(() => {
    const reply = latest.current.reply;
    if (!reply || !awaitingReply.current) return;
    awaitingReply.current = false;
    if (muted) return;
    stopSpeaking.current?.();
    stopSpeaking.current = speakLines(reply.lines, { onStart: () => setSpeaking(true), onEnd: () => { setSpeaking(false); stopSpeaking.current = null; } });
    // Some engines never fire onstart without voices; show speaking while queued.
    setSpeaking(true);
  }, [replyKey]);

  const toggleMute = useCallback(() => {
    setMuted(value => {
      const next = !value;
      try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* Private mode keeps it for this page. */ }
      if (next) stopSpeaking.current?.();
      return next;
    });
  }, []);
  const expectReply = useCallback(() => { awaitingReply.current = true; }, []);
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const say = useCallback((lines: string[]) => {
    if (mutedRef.current || !lines.length) return;
    stopSpeaking.current?.();
    stopSpeaking.current = speakLines(lines.flatMap(line => shortSentences(line, 3, 240)), { onStart: () => setSpeaking(true), onEnd: () => { setSpeaking(false); stopSpeaking.current = null; } });
    setSpeaking(true);
  }, []);

  const holdProps: VoiceAgent["holdProps"] = {
    onPointerDown: event => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no capture. */ }
      press();
    },
    onPointerUp: () => release(),
    onPointerCancel: () => release(),
    onLostPointerCapture: () => release(),
    onKeyDown: event => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); event.stopPropagation(); press(); }
    },
    onKeyUp: event => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); release(); }
    },
    onContextMenu: event => event.preventDefault(),
  };
  return { phase, transcript, supported, muted, toggleMute, speaking, press, release, expectReply, say, holdProps };
}
