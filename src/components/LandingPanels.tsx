import { useMemo } from "react";
import { ChevronRight, Mic, Ruler, Smartphone } from "lucide-react";
import type { Navigate } from "../App";
import { heroProduct } from "../lib/heroProduct";
import { DroneStage } from "./HeroDrone";

// Two panels in the order a change happens: point, say and check it holds; then see it in your room.
// Each shows the real interface pattern on a tinted grid, not a picture of it.
export default function LandingPanels({ navigate, still = false }: { navigate: Navigate; still?: boolean }) {
  const parts = useMemo(() => heroProduct.parts().filter(part => part.role !== "reference"), []);
  return <section className="lp-panels" aria-label="What happens when you ask for a change">
    <article className="lp-panel lp-panel-wide">
      <div className="lp-panel-copy">
        <h2>Point at it, say it, and see that it still holds.</h2>
        <p>The assistant names the part back to you and proposes the change in numbers. Before you say yes, the same strength test runs on the part before and after, under the same load.</p>
        <details className="lp-how">
            <summary>How we checked</summary>
            <p>Under the same 1 kgf (9.8 N) peak motor thrust, upward at the motor end, Arm, front right bends 70% less (1.19 mm to 0.36 mm) and its typical stress drops 52%.</p>
            <p>It is a strength simulation of the one arm, held where it meets the frame, refined until the result stopped changing. Holding the arm fully fixed at the frame is a simplification.</p>
          </details>
      </div>
      <div className="lp-panel-backdrop lp-wide-backdrop" aria-hidden="true">
        <div className="lp-card lp-chat">
          <p className="lp-pointing"><span className="lp-you-dot"/>Pointing at: <strong>{heroProduct.focusPartName}</strong></p>
          <p className="lp-said"><Mic size={15}/>“Make these arms stiffer.”</p>
          <div className="lp-reply">
            <span className="lp-reply-who"><span className="lp-agent-dot"/>Assistant</span>
            <p>I can make all four arms thicker. Here is the change:</p>
            <dl><div><dt>Arm thickness</dt><dd><del>4 mm</del><ChevronRight size={12}/><strong>6 mm</strong></dd></div></dl>
            <div className="lp-fake-actions"><span className="lp-fake-button is-primary">Preview</span><span className="lp-fake-button">Dismiss</span></div>
          </div>
        </div>
        <div className="lp-card lp-proof">
          <p className="lp-proof-label">Checked on Arm, front right: 4 mm to 6 mm</p>
          <p className="lp-proof-big"><strong>70%</strong> less bending</p>
          <p className="lp-proof-load"><Ruler size={15}/>Same test both times: 1 kgf of motor thrust at the tip</p>
          <div className="lp-bars">
            <div><span>Before</span><i style={{width: "100%"}}/><b>1.19 mm</b></div>
            <div><span>After</span><i style={{width: "30%"}} className="is-after"/><b>0.36 mm</b></div>
          </div>
        </div>
      </div>
    </article>

    <article className="lp-panel lp-panel-room">
      <div className="lp-panel-copy">
        <h2>Put it on your desk before you make it.</h2>
        <p>Open the design on your phone and place it at real size, so you can see whether it fits before you print, cut or order a single part.</p>
        <button className="button primary" onClick={() => navigate("/new")}>Start a design <ChevronRight size={18}/></button>
      </div>
      <div className="lp-panel-backdrop lp-room-backdrop">
        <div className="lp-phone" aria-hidden="true">
          <div className="lp-phone-screen">
            <DroneStage parts={parts} still={still} floor camera={[480, 270, 560]} target={[0, -14, 0]} className="is-phone"/>
            <span className="lp-phone-bar"><Smartphone size={15}/>View in your room</span>
          </div>
        </div>
      </div>
    </article>
  </section>;
}
