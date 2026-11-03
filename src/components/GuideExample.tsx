import { useMemo, useState } from "react";
import { createDesign, deriveDesign } from "../shared/engine";
import ModelCanvas from "./ModelCanvas";
import type { Design } from "../shared/types";

export default function GuideExample() {
  const [diameter, setDiameter] = useState(220);
  const original = useMemo(() => createDesign("turntable"), []);
  const baseline = useMemo(() => deriveDesign(original), [original]);
  const design = useMemo<Design>(
    () => ({ ...original, params: { ...original.params, diameter } }),
    [original, diameter],
  );
  const current = useMemo(() => deriveDesign(design), [design]);
  const parts = useMemo(
    () => current.parts.filter((part) => part.role !== "reference"),
    [current],
  );
  const platter = current.parts.find((part) => part.id === "platter")!;
  const base = current.parts.find((part) => part.id === "base-floor")!;
  const originalPlatter = baseline.parts.find((part) => part.id === "platter")!;
  const originalBase = baseline.parts.find((part) => part.id === "base-floor")!;
  const baseSpecification = current.bom
    .find((part) => part.id === "base-floor")!
    .specification.split(" · ")[0];

  return (
    <section
      className="guide-example"
      data-testid="guide-dimension-preview"
      aria-labelledby="guide-example-title"
    >
      <h2 id="guide-example-title">A wider platter needs a wider base.</h2>
      <div className="guide-size-control">
        <span id="guide-size-label">Platter diameter</span>
        <div role="group" aria-labelledby="guide-size-label">
          {[220, 280].map((size) => (
            <button
              key={size}
              className={"button" + (diameter === size ? " primary" : "")}
              aria-pressed={diameter === size}
              onClick={() => setDiameter(size)}
            >
              {size} mm
            </button>
          ))}
        </div>
      </div>
      <div className="guide-example-body">
        <div className="guide-model" data-testid="guide-model">
          <ModelCanvas parts={parts} ariaLabel="Turntable size comparison" />
          <p className="guide-model-hint">Drag to rotate.</p>
        </div>
        <div className="guide-values" aria-live="polite" aria-atomic="true">
          <table>
            <caption>Diameter in millimetres</caption>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Start</th>
                <th scope="col">Current</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Platter</th>
                <td>{originalPlatter.size[0]}</td>
                <td data-testid="guide-platter-diameter">{platter.size[0]}</td>
              </tr>
              <tr>
                <th scope="row">Base plate</th>
                <td>{originalBase.size[0]}</td>
                <td data-testid="guide-base-diameter">{base.size[0]}</td>
              </tr>
            </tbody>
          </table>
          <p className="guide-fixed-values">
            Unchanged: {design.params.height} mm height, {design.params.shaftDiameter}
            {" "}mm shaft, {design.params.rpm} rpm.
          </p>
          <p className="guide-bom">
            <strong>Base plate in the parts list</strong>
            <span data-testid="guide-bom-spec">{baseSpecification}</span>
          </p>
        </div>
      </div>
      <p className="guide-example-next">
        Compare sizes here, then start with the standard 220 mm design.
      </p>
    </section>
  );
}
