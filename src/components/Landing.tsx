import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Layers3, Pause, Play } from "lucide-react";
import type { Navigate } from "../App";
import { createDesign, deriveDesign } from "../shared/engine";
import LandingScene from "./LandingScene";
import "./landing.css";

export default function Landing({ navigate }: { navigate: Navigate }) {
  const design = useMemo(() => createDesign("turntable"), []);
  const derived = useMemo(() => deriveDesign(design), [design]);
  const comparison = useMemo(() => [design, {...design, params: {...design.params, diameter: 280}}].map(d => {
    const model = deriveDesign(d);
    return {platter: model.parts.find(p => p.id === "platter")!.size[0], base: model.parts.find(p => p.id === "base-floor")!.size[0]};
  }), [design]);
  const parts = useMemo(() => derived.parts.filter(p => p.role !== "reference"), [derived]);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(true), [separated, setSeparated] = useState(!reduced);
  const [visible, setVisible] = useState(true), [manual, setManual] = useState(false);
  const hero = useRef<HTMLElement>(null);
  useEffect(() => {
    const q = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setReduced(q.matches); if (q.matches) setSeparated(false); };
    q.addEventListener("change", change); return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!hero.current) return;
    const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {threshold: .08});
    observer.observe(hero.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || reduced || !visible || manual || !separated) return;
    const timer = window.setTimeout(() => setSeparated(false), 2400);
    return () => clearTimeout(timer);
  }, [playing, reduced, visible, manual, separated]);
  const moving = playing && visible && !reduced;
  return <main className="landing-page">
    <section className="landing-hero" ref={hero} aria-labelledby="landing-title">
      <div className="landing-copy">
        <p className="landing-kicker">Your ideas. Real moving parts.</p>
        <h1 id="landing-title">Design it.<br/>See it work.<br/><span>Make it yours.</span></h1>
        <p className="landing-intro">Explore working 3D products. Shape the details together, then download CAD files, parts lists and assembly instructions.</p>
        <div className="landing-actions">
          <button className="button primary" data-testid="landing-try" onClick={() => navigate("/designs/turntable")}>Try the turntable <ChevronRight size={18}/></button>
          <button className="button" data-testid="landing-browse" onClick={() => navigate("/browse")}>Browse designs</button>
        </div>
      </div>
      <div className="landing-product">
        <div className="landing-product-caption"><span>Motorized turntable</span><span>{design.params.diameter} mm / {design.params.rpm} rpm</span></div>
        <LandingScene parts={parts} playing={moving} separated={separated} reduced={reduced}/>
        <div className="landing-product-toolbar">
          <span>{separated ? "See how the parts fit" : "A working mechanism, ready to change"}</span>
          <div>
            <button className="button" data-testid="landing-assembly-toggle" onClick={() => {setManual(true);setSeparated(s => !s);}} aria-pressed={separated}><Layers3 size={16}/>{separated ? "Show assembled" : "Show parts"}</button>
            <button className="button icon-only" data-testid="landing-motion-toggle" aria-label={playing && !reduced ? "Pause animation" : "Play animation"} aria-pressed={playing && !reduced} disabled={reduced} title={reduced ? "Animation follows your reduced-motion setting" : undefined} onClick={() => setPlaying(p => !p)}>{playing && !reduced ? <Pause size={17}/> : <Play size={17}/>}</button>
          </div>
        </div>
        <span className="landing-drag-note">Drag the model to look around{reduced ? " · Motion reduced" : ""}</span>
      </div>
      <div className="landing-hero-footer"><span>From a working idea to your next build.</span><span>Explore the possibilities below</span></div>
    </section>
    <section className="landing-process" aria-labelledby="landing-process-title">
      <div className="landing-process-heading"><span className="eyebrow">The design is only the beginning</span><h2 id="landing-process-title">Change one detail.<br/>Follow it through.</h2><p>A wider platform needs a wider base. See connected dimensions, parts and assembly instructions update as you shape the design.</p><button className="button" onClick={() => navigate("/judge")}>Explore the workflow <ChevronRight size={18}/></button></div>
      <div className="landing-drawing" aria-label={comparison.map(c => `A ${c.platter} millimeter turntable has a ${c.base} millimeter base`).join("; ")}>
        <div className="landing-drawing-top"><span>Platter diameter</span><strong>{comparison[0].platter} <small>mm</small><span className="landing-dimension-divider">/</span>{comparison[1].platter} <small>mm</small></strong></div>
        <svg viewBox="0 0 500 300" role="img" aria-label="Two top views compare the original platform and wider platform with their connected bases.">
          {comparison.map((c, i) => <g key={c.platter} transform={`translate(${i ? 370 : 120} 130)`}>
            <circle r={c.platter * .372}/><circle className="landing-base-outline" r={c.base * .372}/><circle r="8"/>
            <path d={`M${-c.platter*.372} 104h${c.platter*.744}M${-c.platter*.372} 96v16M${c.platter*.372} 96v16`}/>
            <text y="130" textAnchor="middle">Platter {c.platter} mm</text>
            <text y="155" textAnchor="middle">Base {c.base} mm</text>
          </g>)}
        </svg>
        <div className="landing-drawing-bottom"><span>Connected base diameter</span><strong>{comparison[0].base} mm <span>/</span> {comparison[1].base} mm</strong></div>
      </div>
    </section>
    <section className="landing-start"><div><span className="eyebrow">A starting point for what comes next</span><h2>Make your next idea tangible.</h2><p>Choose from six working designs, or start with a shape of your own.</p></div><div className="landing-actions"><button className="button primary" onClick={() => navigate("/browse")}>Explore all designs <ChevronRight size={18}/></button><button className="button" onClick={() => navigate("/new")}>Start a new design</button></div></section>
  </main>;
}
