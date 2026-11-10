import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ImagePlus, Layers3, Loader2, Mic, Pause, Play } from "lucide-react";
import type { Navigate } from "../App";
import { createDesign, deriveDesign } from "../shared/engine";
import { create, pathFor } from "../lib/api";
import { FIRST_REQUEST_KEY, heroProduct, starterFor } from "../lib/heroProduct";
import LandingScene from "./LandingScene";
import LandingBuildStory from "./LandingBuildStory";
import LandingStory from "./LandingStory";
import LandingPanels from "./LandingPanels";
import "./landing.css";
import "./landing-home.css";

const HeroDrone = lazy(() => import("./HeroDrone"));

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const EXAMPLES = ["A camera drone for my backpack", "A desk arm for my phone"];

export default function Landing({ navigate }: { navigate: Navigate }) {
  const still = useMemo(() => new URLSearchParams(location.search).has("still"), []);
  return <main className={"landing-page" + (still ? " is-still" : "")}>
    <LandingHero navigate={navigate} still={still}/>
    <LandingStory navigate={navigate} still={still}/>
    <section className="lp-barrier" aria-labelledby="lp-barrier-title">
      <h2 id="lp-barrier-title">Most design tools make you learn the tool first.</h2>
      <div>
        <p>Here you point at the part and say what you want. The assistant changes the 3D model, checks it, and you decide what to keep.</p>
        <p className="lp-who">For makers, students and small hardware teams. Today it designs desk arms, turntables, sliders, conveyors, lamps, planters and holders. It designs and checks the parts; you print, cut or order them yourself.</p>
      </div>
    </section>
    <LandingPanels navigate={navigate} still={still}/>
    <TurntableSection navigate={navigate}/>
    <section className="lp-closing" aria-labelledby="lp-closing-title">
      <img className="lp-decor lp-closing-gear" src="/decor/gear.webp" alt="" aria-hidden="true"/>
      <img className="lp-decor lp-closing-spring" src="/decor/spring.webp" alt="" aria-hidden="true"/>
      <h2 id="lp-closing-title">What will you change first?</h2>
      <p>Open a working design, point at a part and say it.</p>
      <div className="lp-closing-actions">
        <button className="button primary" onClick={() => window.scrollTo({top: 0, behavior: "smooth"})}>Start with your idea</button>
        <button className="button" onClick={() => navigate("/browse")}>Browse designs</button>
      </div>
    </section>
  </main>;
}

type Speech = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };

function LandingHero({ navigate, still }: { navigate: Navigate; still: boolean }) {
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
  return <section className="lp-hero" aria-labelledby="landing-title">
    <img className="lp-decor lp-d-prop" src="/decor/propeller.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-gear" src="/decor/gear.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-motor" src="/decor/motor.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-spring" src="/decor/spring.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-bearing" src="/decor/bearing.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-bolt" src="/decor/bolt.webp" alt="" aria-hidden="true"/>
    <div className="lp-hero-copy">
      <h1 id="landing-title">Point at any part and say what to change.</h1>
      <p className="lp-sub">Hardware Studio redesigns it in 3D, tests that it still holds, and lets you see it in your room before you build it.</p>
      <HeroModel still={still || reduced}/>
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
    </div>
  </section>;
}

// The hero's live drone. Phones get a still rendered from the same scene.
function HeroModel({ still }: { still: boolean }) {
  const parts = useMemo(() => heroProduct.parts(), []);
  const [phone] = useState(() => matchMedia("(max-width: 640px)").matches);
  if (phone) return <div className="hero-drone is-image"><img src="/previews/drone-hero.png" alt={heroProduct.name + ", 3D model"} width="1200" height="640"/></div>;
  return <Suspense fallback={<div className="hero-drone"/>}><HeroDrone parts={parts} still={still}/></Suspense>;
}

// The turntable section keeps its working scene, size controls and build sheet.
function TurntableSection({ navigate }: { navigate: Navigate }) {
  const design = useMemo(() => createDesign("turntable"), []);
  const variants = useMemo(() => [220,230,240,250,260,270,280].map(diameter => {
    const current = {...design, params: {...design.params, diameter}};
    return {diameter, parts: deriveDesign(current).parts};
  }), [design]);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(true), [separated, setSeparated] = useState(false);
  const [visible, setVisible] = useState(false), [manual, setManual] = useState(false);
  const [progress, setProgress] = useState(0), [manualSize, setManualSize] = useState<number | null>(null);
  const [reportedAssembly, setReportedAssembly] = useState(0);
  const story = useRef<HTMLDivElement>(null), hero = useRef<HTMLElement>(null);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const moving = playing && visible && pageVisible && !reduced;
  useEffect(() => {
    const change = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setReduced(q.matches); if (q.matches) {setSeparated(false);setManual(false);setProgress(0);} };
    q.addEventListener("change", change); return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!hero.current) return;
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {threshold: .05});
    observer.observe(hero.current); return () => observer.disconnect();
  }, []);
  // One screen tall: the chapter buttons move the scene between its three views.
  const tween = useRef(0);
  useEffect(() => () => cancelAnimationFrame(tween.current), []);
  function animateTo(target: number) {
    cancelAnimationFrame(tween.current);
    if (reduced) { setProgress(target); return; }
    const from = progress, start = performance.now(), duration = 900;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      setProgress(from + (target - from) * eased);
      if (t < 1) tween.current = requestAnimationFrame(step);
    };
    tween.current = requestAnimationFrame(step);
  }
  const scrollSize = 220 + Math.round(clamp((progress - .63) / .3) * 6) * 10;
  const diameter = manualSize ?? scrollSize;
  const current = variants.find(v => v.diameter === diameter)!;
  const base = current.parts.find(p => p.id === "base-floor")!.size[0];
  const chapter = progress < .10 ? 0 : progress < .62 ? 1 : 2;
  function exploreChapter(index: number) {
    setManual(false); setManualSize(null); setPlaying(true);
    animateTo([0, .24, .94][index]);
  }
  const captions = ["A working design. Every part connected.", "See what makes the mechanism work.", "One dimension changes the whole design."];
  function toggleAssembly() {setManual(true);setSeparated(manual ? !separated : reportedAssembly < .5);}
  return <>
    <div className={"landing-story" + (reduced ? " is-reduced" : "")} ref={story}>
      <section className="landing-hero" ref={hero} aria-labelledby="landing-turntable-title" data-chapter={chapter}>
        <LandingScene parts={current.parts} playing={moving} separated={separated} manual={manual} reduced={reduced} progress={progress} diameter={diameter} onAssembly={setReportedAssembly}/>
        <div className="landing-copy">
          <span className="landing-product-label">Try it yourself: motorized turntable</span>
          <h2 id="landing-turntable-title">{chapter === 0 ? "Change one size. Everything follows." : chapter === 1 ? "Inside the mechanism." : "Connected dimensions."}</h2>
          <p className="landing-intro">{chapter === 0 ? "A real, working design. Look inside, then pick a size and watch the base follow." : chapter === 1 ? "Follow the motor, shaft and rotating platter." : "A wider platter needs a wider base. Choose a size and see both change."}</p>
          <div className="landing-actions"><button className="button primary" data-testid="landing-try" onClick={() => navigate("/designs/turntable")}>Try the turntable <ChevronRight size={18}/></button>{chapter === 0 && <button className="button action-secondary" data-testid="landing-browse" onClick={() => navigate("/browse")}>Browse designs</button>}</div>
        </div>
        {!reduced && <nav className="landing-chapters" aria-label="Explore the turntable">{["See it work", "Look inside", "Change the size"].map((label, index) => <button key={label} className="landing-chapter" aria-current={chapter === index ? "step" : undefined} onClick={() => exploreChapter(index)}><span className="landing-chapter-track" aria-hidden="true"><i style={{transform: `scaleX(${chapter > index ? 1 : chapter === index ? .55 : 0})`}}/></span>{label}</button>)}</nav>}
        <div className="landing-spec"><span className="eyebrow">Motorized turntable</span><strong>{diameter}<small>mm platter</small></strong><span>{base} mm base / {design.params.rpm} rpm</span></div>
        <div className="landing-scene-caption"><span>{captions[chapter]}</span>{(manual || manualSize !== null) && !reduced && <button className="button landing-follow" data-testid="landing-follow-scroll" onClick={() => {setManual(false);setManualSize(null);setPlaying(true);}}>Follow scroll</button>}{reduced && <small>Motion reduced. Choose a size or inspect the parts.</small>}</div>
        <div className="landing-controls">
          <div className="landing-control-buttons">
            <div className="landing-size-buttons" role="group" aria-label="Platter diameter">{[220,280].map(size => <button className="button" key={size} data-testid={`landing-size-${size}`} aria-pressed={diameter===size} onClick={() => setManualSize(size)}>{size} mm</button>)}</div>
            <button className="button" data-testid="landing-assembly-toggle" onClick={toggleAssembly} aria-pressed={manual ? separated : reportedAssembly >= .5}><Layers3 size={16}/>{(manual ? separated : reportedAssembly >= .5) ? "Show assembled" : "Show parts"}</button>
            <button className="button icon-only" data-testid="landing-motion-toggle" aria-label={playing && !reduced ? "Pause animation" : "Play animation"} aria-pressed={playing && !reduced} disabled={reduced} title={reduced ? "Animation follows your reduced-motion setting" : undefined} onClick={() => setPlaying(p => !p)}>{playing && !reduced ? <Pause size={17}/> : <Play size={17}/>}</button>
          </div>
        </div>
      </section>
    </div>
    <LandingBuildStory parts={current.parts} navigate={navigate} onSize={setManualSize}/>
  </>;
}
