import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Navigate } from "../App";
import { heroProduct } from "../lib/heroProduct";
import { DroneStage } from "./HeroDrone";

const STEPS = [
  { title: "Point at a part", body: "Move over the model. A circle shows exactly which part and feature you mean.", line: "Pointing at the front-left arm" },
  { title: "Say what to change", body: "Hold to talk and say it plainly. The assistant answers out loud and points at the parts it will change.", line: "“Make these arms stiffer.”" },
  { title: "Check that it still holds", body: "The same strength test runs before and after, under the same load, so you see the difference before you accept anything.", line: "Arms 4 mm to 6 mm: 70% less bending under the same thrust" },
  { title: "Accept the change", body: "One click updates the parts, the assembly steps and the build files together.", line: "All four arms now 6 mm, files updated" },
  { title: "See it in your room", body: "Open it on your phone and place it at real size. Then download the files to build it.", line: "Real size, on your desk" },
];

// A sticky, scroll-scrubbed walk through the five steps on the hero product.
export default function LandingStory({ navigate, still }: { navigate: Navigate; still: boolean }) {
  const parts = useMemo(() => heroProduct.parts().filter(part => part.role !== "reference"), []);
  const changed = useMemo(() => heroProduct.changedParts().filter(part => part.role !== "reference"), []);
  const focus = heroProduct.focusPartId;
  const section = useRef<HTMLElement>(null);
  const [reduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const scrubbed = !reduced && !still;
  const [progress, setProgress] = useState(0), [manualStep, setManualStep] = useState<number | null>(null);
  useEffect(() => {
    if (!scrubbed) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = section.current; if (!el) return;
      const r = el.getBoundingClientRect();
      setProgress(Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - innerHeight))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); setManualStep(null); };
    measure(); addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll);
    return () => { removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, [scrubbed]);
  const step = manualStep ?? Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));
  function go(index: number) {
    const el = section.current;
    if (!scrubbed || !el) { setManualStep(index); return; }
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + (r.height - innerHeight) * ((index + .5) / STEPS.length), behavior: "smooth" });
  }
  return <section id="lp-story" ref={section} className={"lp-story" + (scrubbed ? " is-scrubbed" : "")} aria-labelledby="lp-story-title">
    <div className="lp-story-sticky">
      <div className="lp-story-copy">
        <p className="eyebrow">How it works</p>
        <h2 id="lp-story-title">You point and talk. It does the modelling.</h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => <li key={s.title} className={i === step ? "is-active" : i < step ? "is-done" : ""}>
            <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined}>
              <span className="lp-step-number" aria-hidden="true">{i + 1}</span>
              <span><strong>{s.title}</strong>{i === step && <span className="lp-step-body">{s.body}</span>}</span>
            </button>
          </li>)}
        </ol>
        <button className="button primary" onClick={() => navigate("/new")}>Try it on the drone <ChevronRight size={18}/></button>
      </div>
      <div className="lp-story-stage" data-step={step}>
        <div className="lp-story-model" aria-hidden="true"><DroneStage parts={step >= 3 ? changed : parts} still={!scrubbed} idle={false} exploded={step === 2} highlight={step === 0 ? [focus] : step <= 2 ? [...heroProduct.changedPartIds] : []} dimOthers={step === 1} camera={[470, 340, 550]} target={[0, -12, 0]}/></div>
        <div className={"lp-story-line" + (step === 1 || step === 2 ? " is-assistant" : "")} aria-live="polite">
          <span className="lp-line-dot" aria-hidden="true"/>{STEPS[step].line}
        </div>
        <div className="lp-scrubber" aria-hidden="true"><i style={{ transform: `scaleX(${scrubbed ? Math.max(.02, progress) : (step + 1) / STEPS.length})` }}/></div>
      </div>
    </div>
  </section>;
}
