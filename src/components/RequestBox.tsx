import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Mic } from "lucide-react";
import type { Navigate } from "../App";
import { create, pathFor } from "../lib/api";
import { FIRST_REQUEST_KEY, starterFor } from "../lib/heroProduct";

const EXAMPLES = ["A camera drone for my backpack", "A desk arm for my phone"];

type Speech = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };

// The request box: type or hold to talk, add a photo, then Build it opens the closest
// starter in the studio with this request ready for the assistant. Never focuses itself.
export default function RequestBox({ navigate, still }: { navigate: Navigate; still: boolean }) {
  const [text, setText] = useState(""), [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [listening, setListening] = useState(false);
  const [typed, setTyped] = useState(""), [focused, setFocused] = useState(false);
  const recognition = useRef<Speech | null>(null);
  const field = useRef<HTMLTextAreaElement>(null), file = useRef<HTMLInputElement>(null);
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  // The placeholder types the example requests until someone starts typing or talking.
  useEffect(() => {
    if (reduced || still || focused || text || listening) { setTyped(""); return; }
    let example = 0, index = 0, timer = 0, holding = false;
    const tick = () => {
      const target = EXAMPLES[example];
      if (holding) { holding = false; index = 0; example = (example + 1) % EXAMPLES.length; setTyped(""); timer = window.setTimeout(tick, 400); return; }
      index += 1; setTyped(target.slice(0, index));
      if (index >= target.length) { holding = true; timer = window.setTimeout(tick, 1800); return; }
      timer = window.setTimeout(tick, 45);
    };
    timer = window.setTimeout(tick, 900);
    return () => window.clearTimeout(timer);
  }, [reduced, still, focused, text, listening]);
  function startListening() {
    const Ctor = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as (new () => Speech) | undefined;
    if (!Ctor) { setError("Voice needs a browser with speech recognition, such as Chrome. You can type instead."); field.current?.focus(); return; }
    if (recognition.current) return;
    const r = new Ctor(); r.lang = "en-US"; r.interimResults = true; r.continuous = true;
    r.onresult = (e: any) => setText(Array.from(e.results as ArrayLike<any>).map((x: any) => x[0]?.transcript || "").join(" ").trim());
    r.onend = () => { recognition.current = null; setListening(false); };
    r.onerror = (e: any) => { setError(e?.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser, or type instead." : "Voice stopped. Try again, or type instead."); };
    recognition.current = r; setError(""); setListening(true);
    try { r.start(); } catch { recognition.current = null; setListening(false); }
  }
  function stopListening() { try { recognition.current?.stop(); } catch { /* already stopped */ } }
  async function build(request = text) {
    const ask = request.trim();
    if (!ask) { field.current?.focus(); setError("Describe what you want to make, or hold the mic and say it."); return; }
    setBusy(true); setError("");
    try {
      const starter = starterFor(ask);
      const r = await create("custom", starter.name, starter.parts());
      try { sessionStorage.setItem(FIRST_REQUEST_KEY, JSON.stringify({ id: r.snapshot.design.id, text: ask, image })); } catch { /* storage unavailable */ }
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function attach(f?: File) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Add a photo (JPG or PNG)."); return; }
    const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(f);
  }
  return <>
      <form className="lp-prompt" onSubmit={e => { e.preventDefault(); void build(); }}>
        <label htmlFor="lp-request" className="sr-only">Describe what you want to make</label>
        <div className="lp-field">
          <textarea id="lp-request" ref={field} rows={2} value={text} onChange={e => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void build(); } }}
            placeholder={typed || "Describe your product, or hold the mic and say it"}/>
          {image && <span className="lp-attached"><img src={image} alt="Your photo"/><button type="button" className="button small quiet" onClick={() => setImage(null)}>Remove photo</button></span>}
        </div>
        <div className="lp-prompt-row">
          <button type="button" className={"lp-mic" + (listening ? " is-listening" : "")} aria-pressed={listening}
            onPointerDown={e => { e.preventDefault(); startListening(); }} onPointerUp={stopListening} onPointerLeave={() => { if (listening) stopListening(); }}
            onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); startListening(); } }}
            onKeyUp={e => { if (e.key === " " || e.key === "Enter") stopListening(); }}>
            <span className="lp-orb" aria-hidden="true"><Mic size={18}/></span>{listening ? "Listening, let go to stop" : "Hold to talk"}
          </button>
          <button type="button" className="lp-photo" aria-label="Add a photo or video" onClick={() => file.current?.click()}><ImagePlus size={18}/><span>Add a photo</span></button>
          <input ref={file} type="file" accept="image/*" hidden onChange={e => attach(e.target.files?.[0])}/>
          <span className="lp-spacer"/>
          <button className="button primary lp-build" disabled={busy}>{busy ? <Loader2 className="spin" size={18}/> : null}Build it</button>
        </div>
      </form>
      {error && <p className="lp-error" role="alert">{error}</p>}
      <div className="lp-chips" role="group" aria-label="Example requests">
        {EXAMPLES.map(example => <button key={example} type="button" className="lp-chip" onClick={() => { setText(example); field.current?.focus(); }}>{example}</button>)}
      </div>
  </>;
}
