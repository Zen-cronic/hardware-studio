import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Layers3, Pause, Play } from "lucide-react";
import type { Navigate } from "../App";
import { createDesign, deriveDesign } from "../shared/engine";
import { heroProduct } from "../lib/heroProduct";
import LandingScene from "./LandingScene";
import LandingBuildStory from "./LandingBuildStory";
import LandingStory from "./LandingStory";
import LandingPanels from "./LandingPanels";
import RequestBox from "./RequestBox";
import "./landing.css";
import "./landing-home.css";

const HeroDrone = lazy(() => import("./HeroDrone"));

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export default function Landing({ navigate }: { navigate: Navigate }) {
  const still = useMemo(() => new URLSearchParams(location.search).has("still"), []);
  return <main className={"landing-page" + (still ? " is-still" : "")}>
    <LandingHero navigate={navigate} still={still}/>
    <LandingStory navigate={navigate} still={still}/>
    <section className="lp-barrier" aria-labelledby="lp-barrier-title">
      <h2 id="lp-barrier-title">Most design tools make you learn the tool first.</h2>
      <div>
        <p>Here you point at the part and say what you want. The assistant names the part back, proposes the change in numbers, and runs the same strength test before and after, under the same load. You decide what to keep.</p>
        <p className="lp-who">For makers, students and small hardware teams. Today it starts from a camera drone, a desk arm and six other working designs. It designs and checks the parts; you print, cut or order them yourself.</p>
        <details className="lp-how">
          <summary>How we checked</summary>
          <p>Under the same 1 kgf (9.8 N) peak motor thrust, upward at the motor end, the drone’s front-right arm bends 70% less (1.19 mm to 0.36 mm) and its typical stress drops 52%.</p>
          <p>It is a strength simulation of the one arm, held where it meets the frame, refined until the result stopped changing. Holding the arm fully fixed at the frame is a simplification.</p>
        </details>
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

function LandingHero({ navigate, still }: { navigate: Navigate; still: boolean }) {
  const reduced = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  return <section className="lp-hero" aria-labelledby="landing-title">
    <img className="lp-decor lp-d-prop" src="/decor/propeller.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-gear" src="/decor/gear.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-motor" src="/decor/motor.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-spring" src="/decor/spring.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-bearing" src="/decor/bearing.webp" alt="" aria-hidden="true"/>
    <img className="lp-decor lp-d-bolt" src="/decor/bolt.webp" alt="" aria-hidden="true"/>
    <div className="lp-hero-copy">
      <h1 id="landing-title">Make anything from scratch.</h1>
      <p className="lp-sub">Click any part of a 3D design and say or type what to change. Make Anything redesigns it, checks the part’s strength with a computer simulation, shows it at real size on your phone, and gives you the CAD files and parts list to build it.</p>
      <HeroModel still={still || reduced}/>
      <RequestBox navigate={navigate} still={still}/>
    </div>
  </section>;
}

// The hero's live drone. Phones get a still rendered from the same scene.
function HeroModel({ still }: { still: boolean }) {
  const parts = useMemo(() => heroProduct.parts(), []);
  const [phone] = useState(() => matchMedia("(max-width: 640px)").matches);
  if (phone) return <div className="hero-drone is-image"><img src="/previews/drone.png" alt={heroProduct.name + ", 3D model"} width="650" height="445"/></div>;
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
          <h2 id="landing-turntable-title">{chapter === 0 ? "Change one size. Everything follows." : chapter === 1 ? "Inside the mechanism." : "Connected dimensions."}</h2>
          <p className="landing-intro">{chapter === 0 ? "A real, working design. Look inside, then pick a size and watch the base follow." : chapter === 1 ? "Follow the motor, shaft and rotating platter." : "A wider platter needs a wider base. Choose a size and see both change."}</p>
          <div className="landing-actions"><button className="button primary" data-testid="landing-try" onClick={() => navigate("/designs/turntable")}>Try the turntable <ChevronRight size={18}/></button>{chapter === 0 && <button className="button action-secondary" data-testid="landing-browse" onClick={() => navigate("/browse")}>Browse designs</button>}</div>
        </div>
        {!reduced && <nav className="landing-chapters" aria-label="Explore the turntable">{["See it work", "Look inside", "Change the size"].map((label, index) => <button key={label} className="landing-chapter" aria-current={chapter === index ? "step" : undefined} onClick={() => exploreChapter(index)}><span className="landing-chapter-track" aria-hidden="true"><i style={{transform: `scaleX(${chapter > index ? 1 : chapter === index ? .55 : 0})`}}/></span>{label}</button>)}</nav>}
        <div className="landing-spec"><span className="eyebrow">Motorized turntable</span><strong>{diameter}<small>mm platter</small></strong><span>{base} mm base / {design.params.rpm} rpm</span></div>
        <div className="landing-scene-caption"><span>{captions[chapter]}</span>{(manual || manualSize !== null) && !reduced && <button className="button landing-follow" data-testid="landing-follow-scroll" onClick={() => exploreChapter(chapter)}>Back to the tour</button>}{reduced && <small>Motion reduced. Choose a size or inspect the parts.</small>}</div>
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
