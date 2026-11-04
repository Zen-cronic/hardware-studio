import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers3, Pause, Play } from "lucide-react";
import type { Navigate } from "../App";
import { createDesign, deriveDesign } from "../shared/engine";
import LandingScene from "./LandingScene";
import LandingBuildStory from "./LandingBuildStory";
import "./landing.css";

const clamp = (n: number) => Math.max(0, Math.min(1, n));
export default function Landing({ navigate }: { navigate: Navigate }) {
  const design = useMemo(() => createDesign("turntable"), []);
  const variants = useMemo(() => [220,230,240,250,260,270,280].map(diameter => {
    const current = {...design, params: {...design.params, diameter}};
    return {diameter, parts: deriveDesign(current).parts};
  }), [design]);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(true), [separated, setSeparated] = useState(false);
  const [visible, setVisible] = useState(true), [manual, setManual] = useState(false);
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
  useEffect(() => {
    if (reduced || !playing) return;
    let frame = 0;
    const measure = () => {
      if (!story.current) return;
      const r = story.current.getBoundingClientRect();
      setProgress(clamp(-r.top / Math.max(1, r.height - innerHeight)));
      frame = 0;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure(); addEventListener("scroll", onScroll, {passive:true}); addEventListener("resize", onScroll);
    return () => {removeEventListener("scroll", onScroll);removeEventListener("resize", onScroll);cancelAnimationFrame(frame);};
  }, [reduced, playing]);
  const scrollSize = 220 + Math.round(clamp((progress - .63) / .3) * 6) * 10;
  const diameter = manualSize ?? scrollSize;
  const current = variants.find(v => v.diameter === diameter)!;
  const base = current.parts.find(p => p.id === "base-floor")!.size[0];
  const chapter = progress < .10 ? 0 : progress < .62 ? 1 : 2;
  const captions = ["A working design. Every part connected.", "See what makes the mechanism work.", "One dimension changes the whole design."];
  function toggleAssembly() {setManual(true);setSeparated(manual ? !separated : reportedAssembly < .5);}
  return <main className="landing-page">
    <div className={"landing-story" + (reduced ? " is-reduced" : "")} ref={story}>
      <section className="landing-hero" ref={hero} aria-labelledby="landing-title" data-chapter={chapter}>
        <LandingScene parts={current.parts} playing={moving} separated={separated} manual={manual} reduced={reduced} progress={progress} diameter={diameter} onAssembly={setReportedAssembly}/>
        <div className="landing-copy">
          <p className="landing-kicker">A studio for things you can make</p>
          {chapter === 0 ? <h1 id="landing-title">Hardware, <span>brought to life.</span></h1> : chapter === 1 ? <h1 id="landing-title">Inside the mechanism.</h1> : <h1 id="landing-title">Connected dimensions.</h1>}
          <p className="landing-intro">{chapter === 0 ? "Explore working 3D products. Shape the details together, then download CAD files, parts lists and assembly instructions." : chapter === 1 ? "Look inside a real mechanism. Separate the parts, follow the drive and understand how it all comes together." : "A wider platter needs a wider base. Connected dimensions and build files follow the design you choose."}</p>
          <div className="landing-actions"><button className="button primary" data-testid="landing-try" onClick={() => navigate("/designs/turntable")}>Try the turntable <ChevronRight size={18}/></button><button className="button" data-testid="landing-browse" onClick={() => navigate("/browse")}>Browse designs</button></div>
        </div>
        <div className="landing-spec"><span className="eyebrow">Motorized turntable</span><strong>{diameter}<small>mm platter</small></strong><span>{base} mm base · {design.params.rpm} rpm</span></div>
        <div className="landing-controls">
          <div className="landing-scene-caption"><span>{captions[chapter]}</span>{(manual || manualSize !== null) && !reduced && <button className="button landing-follow" data-testid="landing-follow-scroll" onClick={() => {setManual(false);setManualSize(null);setPlaying(true);}}>Follow scroll</button>}<small>{reduced ? "Motion reduced. Choose a size or inspect the parts." : "Scroll to explore the design"}</small></div>
          <div className="landing-control-buttons">
            <div className="landing-size-buttons" role="group" aria-label="Platter diameter">{[220,280].map(size => <button className="button" key={size} data-testid={`landing-size-${size}`} aria-pressed={diameter===size} onClick={() => setManualSize(size)}>{size} mm</button>)}</div>
            <button className="button" data-testid="landing-assembly-toggle" onClick={toggleAssembly} aria-pressed={manual ? separated : reportedAssembly >= .5}><Layers3 size={16}/>{(manual ? separated : reportedAssembly >= .5) ? "Show assembled" : "Show parts"}</button>
            <button className="button icon-only" data-testid="landing-motion-toggle" aria-label={playing && !reduced ? "Pause animation" : "Play animation"} aria-pressed={playing && !reduced} disabled={reduced} title={reduced ? "Animation follows your reduced-motion setting" : undefined} onClick={() => setPlaying(p => !p)}>{playing && !reduced ? <Pause size={17}/> : <Play size={17}/>}</button>
          </div>
        </div>
        {!reduced && <div className="landing-scroll-cue" aria-hidden="true"><ChevronDown size={18}/><span>Explore</span><div><i style={{transform:`scaleY(${Math.max(.05, progress)})`}}/></div></div>}
      </section>
    </div>
    <LandingBuildStory parts={current.parts} navigate={navigate}/>
  </main>;
}
