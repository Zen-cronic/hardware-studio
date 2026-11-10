import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, VolumeX } from "lucide-react";
import type { ScreenTarget } from "../lib/projection";
import type { VoiceAgent, VoicePhase } from "../lib/voiceAgent";
import "./companion.css";

/** One place the assistant points at: a part, or one feature of it. */
export interface AgentTarget {
  key: string;
  label: string;
  partIds: string[];
  featureId?: string;
  /** Show the label beside the circle; off when the 3D view already pins a feature label there. */
  labelled?: boolean;
}
/** Where the assistant is pointing for one reply: one target, or each candidate of a question. */
export interface AgentPointer {
  /** A new key replays the flight. */
  key: string;
  targets: AgentTarget[];
  /** Returns a target in viewport pixels, re-read every frame so circles follow the camera. */
  locate: (target: AgentTarget) => ScreenTarget | null;
}

export interface CompanionCursorProps {
  /** Readable label of the surface under the pointer, from the 3D view. */
  hoverLabel?: string | null;
  phase: VoicePhase;
  /** Live words while listening. */
  transcript?: string;
  agent?: AgentPointer | null;
  speaking?: boolean;
  /** Jump to end states (captures, reduced motion). Detected from ?still=1 and the OS setting when omitted. */
  still?: boolean;
  /** The element the pointer circle follows over. */
  stageSelector?: string;
}

type Point = { x: number; y: number };
const STAGE = ".model-canvas.is-selectable .model-canvas-viewport";

export function prefersStill() {
  if (typeof window === "undefined") return true;
  try {
    return new URLSearchParams(location.search).get("still") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

/** One spring-damped point; settles in about 600 ms from a typical distance. */
function spring(from: Point, velocity: Point, to: Point, dt: number) {
  const k = 120, c = 22; // Critically damped for unit mass: c ≈ 2√k.
  const ax = -k * (from.x - to.x) - c * velocity.x, ay = -k * (from.y - to.y) - c * velocity.y;
  velocity.x += ax * dt; velocity.y += ay * dt;
  from.x += velocity.x * dt; from.y += velocity.y * dt;
  return Math.hypot(from.x - to.x, from.y - to.y) < 0.4 && Math.hypot(velocity.x, velocity.y) < 4;
}

/**
 * A soft circle that trails the pointer over the 3D view and names what it is on, plus an
 * assistant circle that glides to the part a reply is about. DOM-only and pointer-transparent.
 */
export default function CompanionCursor({ hoverLabel, phase, transcript, agent, speaking = false, still, stageSelector = STAGE }: CompanionCursorProps) {
  const [isStill, setStill] = useState(() => still ?? prefersStill());
  useEffect(() => {
    if (still !== undefined) { setStill(still); return; }
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(prefersStill());
    on(); q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [still]);
  const stillRef = useRef(isStill); stillRef.current = isStill;

  // Pointer circle
  const user = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const pointer = useRef<Point | null>(null), drawn = useRef<Point | null>(null), velocity = useRef<Point>({ x: 0, y: 0 });
  const frame = useRef(0), last = useRef(0);
  useEffect(() => {
    const place = () => { const el = user.current, p = drawn.current; if (el && p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`; };
    const tick = (time: number) => {
      const target = pointer.current;
      if (!target) { frame.current = 0; return; }
      if (!drawn.current || stillRef.current) { drawn.current = { ...target }; velocity.current = { x: 0, y: 0 }; place(); frame.current = 0; return; }
      const dt = Math.min(0.05, last.current ? (time - last.current) / 1000 : 1 / 60);
      last.current = time;
      // The pointer circle trails closely: a stiffer spring than the assistant's glide.
      let settled = true;
      for (let i = 0; i < 3; i++) settled = spring(drawn.current, velocity.current, target, dt / 3 * 2.2) && settled;
      place();
      frame.current = settled ? 0 : requestAnimationFrame(tick);
      if (!frame.current) last.current = 0;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const stage = (event.target as Element | null)?.closest?.(stageSelector);
      if (!stage) { setOver(false); return; }
      setOver(true);
      pointer.current = { x: event.clientX, y: event.clientY };
      if (!frame.current) frame.current = requestAnimationFrame(tick);
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) setOver(false); };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => { window.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); cancelAnimationFrame(frame.current); };
  }, [stageSelector]);

  // After a hold or a new reply the layout can move under a still pointer; wait for the next move.
  useEffect(() => { if (phase === "idle") setOver(false); }, [phase]);
  useEffect(() => { if (agent) setOver(false); }, [agent?.key]);

  // Assistant circles: one per target, each gliding from the same start.
  const bots = useRef(new Map<string, HTMLDivElement>());
  const [arrived, setArrived] = useState<string[]>([]);
  const agentRef = useRef(agent); agentRef.current = agent;
  useEffect(() => {
    setArrived([]);
    if (!agent) return;
    // Leave from the pointer circle when it is on screen, else from the lower middle of the view.
    const start = drawn.current && over ? { ...drawn.current } : { x: innerWidth / 2, y: innerHeight - 120 };
    const state = new Map(agent.targets.map(t => [t.key, { p: { ...start }, v: { x: 0, y: 0 }, landed: false }]));
    let id = 0, previous = 0, reported = 0;
    const tick = (time: number) => {
      const current = agentRef.current;
      if (!current) return;
      const dt = Math.min(0.05, previous ? (time - previous) / 1000 : 1 / 60);
      previous = time;
      let landedCount = 0;
      for (const target of current.targets) {
        const s = state.get(target.key), el = bots.current.get(target.key);
        if (!s) continue;
        const at = current.locate(target);
        if (at) {
          if (stillRef.current) { s.p = { x: at.x, y: at.y }; s.landed = true; }
          else {
            const settled = spring(s.p, s.v, at, dt);
            if (settled && !s.landed) s.p = { x: at.x, y: at.y };
            s.landed = s.landed || settled;
          }
        }
        if (s.landed) landedCount++;
        if (el) {
          el.style.transform = `translate3d(${s.p.x}px, ${s.p.y}px, 0)`;
          el.dataset.placed = "true";
          el.dataset.visible = String(!!at?.visible);
          el.dataset.agentState = s.landed ? "arrived" : "flying";
          if (at) el.dataset.targetRect = [at.rect.left, at.rect.top, at.rect.right, at.rect.bottom].map(v => Math.round(v)).join(",");
        }
      }
      if (landedCount !== reported) { reported = landedCount; setArrived(current.targets.filter(t => state.get(t.key)?.landed).map(t => t.key)); }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [agent?.key]);

  const listening = phase !== "idle";
  // While listening the frozen target is pinned on the model itself; the circle shows the words.
  const label = listening ? (phase === "finishing" ? "Sending…" : "Listening…") : hoverLabel || "";
  const showUser = over || listening;
  return (
    <div className="companion-layer" aria-hidden="true" data-still={isStill ? "true" : "false"}>
      <div ref={user} className={"companion-circle is-user" + (listening ? " is-listening" : "") + (showUser ? " is-shown" : "")}
        data-companion="user" data-phase={phase} style={drawn.current ? { transform: `translate3d(${drawn.current.x}px, ${drawn.current.y}px, 0)` } : undefined}>
        <span className="companion-dot" />
        {listening && <span className="companion-ring" />}
        {label && <span className="companion-label" data-companion-label>{label}{listening && transcript ? <em>“{transcript}”</em> : null}</span>}
      </div>
      {agent?.targets.map(target => {
        const landed = arrived.includes(target.key);
        return <div key={agent.key + "|" + target.key} ref={el => { if (el) bots.current.set(target.key, el); else bots.current.delete(target.key); }}
          className={"companion-circle is-agent is-shown" + (landed ? " is-arrived" : "") + (speaking ? " is-speaking" : "")}
          data-companion="agent" data-agent-state={landed ? "arrived" : "flying"} data-agent-target={target.partIds.join(",") + (target.featureId ? ":" + target.featureId : "")}>
          <span className="companion-dot" />
          {speaking && <span className="companion-ring" />}
          {landed && target.labelled && <span className="companion-label is-agent">{target.label}</span>}
        </div>;
      })}
    </div>
  );
}

export interface AgentDockProps {
  voice: VoiceAgent;
  /** What the assistant last said, shown as text as well as spoken. */
  reply?: string;
  disabled?: boolean;
  /** Status when voice cannot be used right now, e.g. while a proposal is open. */
  disabledReason?: string;
  className?: string;
}

/** Hold-to-talk mic, live words, the spoken reply as text, and a mute toggle. */
export function AgentDock({ voice, reply, disabled = false, disabledReason, className = "" }: AgentDockProps) {
  const listening = voice.phase !== "idle";
  const [touch, setTouch] = useState(false);
  useEffect(() => { try { setTouch(matchMedia("(pointer: coarse), (max-width: 820px)").matches); } catch { /* No media queries. */ } }, []);
  const status = !voice.supported ? "Voice needs a browser with speech recognition. You can type instead."
    : listening ? (voice.transcript ? `“${voice.transcript}”` : "Listening… release to send.")
    : reply ? reply
    : disabled && disabledReason ? disabledReason
    : touch ? "Tap a part, then hold the mic and say what to change." : "Hold Space or the mic, point at a part and say what to change.";
  return (
    <div className={"agent-dock " + className} data-testid="agent-dock" data-phase={voice.phase} role="group" aria-label="Talk to the design assistant">
      <button type="button" className={"agent-mic" + (listening ? " is-listening" : "")} data-testid="hold-to-talk"
        aria-label={listening ? "Listening, release to send" : "Hold to talk"} aria-pressed={listening}
        disabled={disabled || !voice.supported} {...voice.holdProps}>
        <Mic size={20} aria-hidden="true" />
        {listening && <span className="agent-mic-ring" aria-hidden="true" />}
      </button>
      <p className="agent-dock-status" aria-live="polite" aria-atomic="true" data-testid="agent-reply">{status}</p>
      <button type="button" className="agent-mute" onClick={voice.toggleMute} aria-pressed={voice.muted}
        aria-label={voice.muted ? "Turn spoken replies on" : "Mute spoken replies"} title={voice.muted ? "Spoken replies off" : "Spoken replies on"}>
        {voice.muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
