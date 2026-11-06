import type { Command, Part, Snapshot } from "./types";
import { deriveDesign, DesignError, readSetFor } from "./engine";
import { productForDesign } from "./catalog";

export type SelectionSource = "click" | "circle" | "list";
export interface SelectionRef {
  designId: string;
  revision: number;
  partIds: string[];
  source: SelectionSource;
}
export type SemanticEdit =
  | { type: "parameter"; key: string; value: number }
  | { type: "dimension"; axis: "x" | "y" | "z"; value: number }
  | { type: "hole"; holeIndex: number | "bore"; diameter: number }
  | { type: "wallThickness"; value: number };
export interface SelectionControl {
  id: string;
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  description: string;
  intent: SemanticEdit;
}
export interface SemanticEditPreview {
  command: Command;
  preview: Snapshot;
  affectedPartIds: string[];
  explanation: string;
}

// The registry selects assembly controls, never a derived mesh resize.
// Version-specific limits and coupled constraints come from productForDesign
// and the canonical generator. This keeps older saved mechanisms intact.
const assemblyControls: Record<string, { match: RegExp; keys: string[] }[]> = {
  turntable: [
    { match: /product/, keys: ["payload", "diameter"] },
    { match: /platter|cover/, keys: ["diameter", "rpm"] },
    { match: /motor|shaft|coupling|hub/, keys: ["rpm", "height", "shaftDiameter"] },
    { match: /.*/, keys: ["diameter", "height"] },
  ],
  slider: [
    { match: /camera/, keys: ["cameraWidth", "railSpacing", "speed"] },
    { match: /carriage|block|guide/, keys: ["railSpacing", "travel", "speed"] },
    { match: /drive|belt|pulley|idler|tension/, keys: ["travel", "speed"] },
    { match: /.*/, keys: ["travel", "railSpacing"] },
  ],
  conveyor: [
    { match: /sensor|gate|diverter/, keys: ["sensorPosition", "speed"] },
    { match: /belt|roller|motor|coupling|parcel/, keys: ["beltWidth", "length", "speed"] },
    { match: /.*/, keys: ["length", "beltWidth"] },
  ],
  lamp: [
    { match: /led|diffuser|shade|head|spreader|thermal/, keys: ["brightness", "angle", "reach"] },
    { match: /base|foot|pad/, keys: ["baseDiameter", "reach"] },
    { match: /.*/, keys: ["reach", "angle"] },
  ],
  planter: [
    { match: /pot|plant|shelf/, keys: ["pots", "potDiameter"] },
    { match: /pump|inlet|outlet|manifold/, keys: ["waterMinutes", "pots", "potDiameter"] },
    { match: /.*/, keys: ["reservoirHeight", "pots", "potDiameter"] },
  ],
  holder: [
    { match: /screw|nut|handle|thrust|journal/, keys: ["screwDiameter", "opening"] },
    { match: /jaw|pad|guide|rod|bushing/, keys: ["jawWidth", "opening"] },
    { match: /.*/, keys: ["angle", "jawWidth", "opening"] },
  ],
};

export function createSelection(
  snapshot: Snapshot,
  partIds: string[],
  source: SelectionSource = "click",
): SelectionRef {
  const selection = { designId: snapshot.design.id, revision: snapshot.design.revision,
    partIds: [...new Set(partIds)], source };
  assertCurrentSelection(snapshot, selection);
  return selection;
}
export function assertCurrentSelection(snapshot: Snapshot, selection: SelectionRef): Part[] {
  if (selection.designId !== snapshot.design.id || selection.revision !== snapshot.design.revision)
    throw new DesignError("The design changed. Select the part again before editing.", "STALE_SELECTION");
  if (!Array.isArray(selection.partIds) || !selection.partIds.length ||
      new Set(selection.partIds).size !== selection.partIds.length)
    throw new DesignError("Select at least one distinct part.", "INVALID_SELECTION");
  return selection.partIds.map(id => {
    const part = snapshot.derived.parts.find(p => p.id === id);
    if (!part) throw new DesignError("A selected part is no longer in this design.", "STALE_SELECTION");
    return part;
  });
}

export function getSelectionControls(snapshot: Snapshot, selection: SelectionRef): SelectionControl[] {
  const parts = assertCurrentSelection(snapshot, selection);
  if (snapshot.design.kind !== "custom") {
    const rules = assemblyControls[snapshot.design.kind] || [];
    const keys = new Set(parts.flatMap(part => rules.find(rule => rule.match.test(part.id))?.keys || []));
    return productForDesign(snapshot.design).parameters.filter(p => keys.has(p.key) && p.max > p.min).map(p => ({
      id: p.key, label: p.label, value: snapshot.design.params[p.key], unit: p.unit,
      step: p.step, min: p.min, max: p.max, description: p.description,
      intent: { type: "parameter", key: p.key, value: snapshot.design.params[p.key] },
    }));
  }
  if (parts.length !== 1 || parts[0].role === "reference" || parts[0].process === "buy") return [];
  const part = parts[0], controls: SelectionControl[] = [];
  const axes = part.shape === "box" ? ["x", "y", "z"] as const : ["x", "y"] as const;
  for (const axis of axes) {
    const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    controls.push({ id: `dimension-${axis}`, label: part.shape === "box" ? `Local ${axis.toUpperCase()} dimension` : axis === "x" ? (part.loopSpan !== undefined ? "Loop length" : "Outer diameter") : "Axial thickness",
      value: part.size[index], unit: "mm", step: 0.5, min: 0.5, max: 5000,
      description: "Changes the selected part in its own axes. Hole positions remain fixed; the complete assembly is regenerated and checked.",
      intent: { type: "dimension", axis, value: part.size[index] } });
  }
  if (part.shape === "tube" && !part.sections) {
    controls.push({ id: "bore", label: "Inner diameter", value: part.holeDiameter!, unit: "mm", step: 0.5,
      min: 0.5, max: part.size[2] - 0.5, description: "The opening through this tube; material must remain around it.",
      intent: { type: "hole", holeIndex: "bore", diameter: part.holeDiameter! } });
    controls.push({ id: "wall", label: "Wall thickness", value: (part.size[2] - part.holeDiameter!) / 2, unit: "mm", step: 0.5,
      min: 0.5, max: (part.size[2] - 0.5) / 2, description: "Changes the inner opening while preserving the outside diameter.",
      intent: { type: "wallThickness", value: (part.size[2] - part.holeDiameter!) / 2 } });
  }
  part.holes?.forEach((hole, index) => controls.push({ id: `hole-${index}`, label: `Hole ${index + 1} diameter`,
    value: hole.diameter, unit: "mm", step: 0.5, min: 0.5, max: Math.max(...part.size),
    description: `Through hole centred at local X ${hole.x.toFixed(1)}, Z ${hole.z.toFixed(1)} mm. Existing counterbore and wall constraints still apply.`,
    intent: { type: "hole", holeIndex: index, diameter: hole.diameter } }));
  return controls;
}

export function selectionSuggestions(snapshot: Snapshot, selection?: SelectionRef): string[] {
  if (!selection) return ["Help me choose dimensions for a camera support.", "Explain how this assembly works.", "What should I check before making this design?"];
  const parts = assertCurrentSelection(snapshot, selection);
  const name = parts.map(p => p.name).join(" and ");
  const controls = getSelectionControls(snapshot, selection);
  return [
    `Explain what ${name} does and how it connects to the other parts.`,
    ...(controls[0] ? [`Help me change ${controls[0].label.toLowerCase()} for ${name}; explain which other parts change.`] : []),
    `Which dimensions and material properties should I verify for ${name}?`,
  ];
}

export function applySemanticEdit(snapshot: Snapshot, selection: SelectionRef, intent: SemanticEdit, actor = "Maker"): SemanticEditPreview {
  const selected = assertCurrentSelection(snapshot, selection);
  if (snapshot.role === "viewer") throw new DesignError("View-only access cannot change the design.", "READ_ONLY");
  const design = structuredClone(snapshot.design), changes: Record<string, number> = {};
  let customParts: Part[] | undefined;
  let description: string;
  if (intent.type === "parameter") {
    const control = getSelectionControls(snapshot, selection).find(c => c.id === intent.key);
    if (!control || snapshot.design.kind === "custom")
      throw new DesignError("That control does not belong to the selected part. Choose one of its available controls.");
    if (!Number.isFinite(intent.value)) throw new DesignError("Enter a finite value.");
    changes[intent.key] = intent.value;
    design.params[intent.key] = intent.value;
    description = `${control.label}: ${snapshot.design.params[intent.key]} → ${intent.value} ${control.unit}`;
  } else {
    if (design.kind !== "custom")
      throw new DesignError("This example uses linked assembly dimensions. Use its available controls; changing an individual feature requires a custom design.", "UNSUPPORTED_EDIT");
    if (selected.length !== 1) throw new DesignError("Choose one part before changing a local dimension.", "AMBIGUOUS_SELECTION");
    if (selected[0].role === "reference" || selected[0].process === "buy")
      throw new DesignError("This is a reference or purchased component. Its measured dimensions are not an editable fabricated part.", "UNSUPPORTED_EDIT");
    customParts = structuredClone(design.customParts!);
    const part = customParts.find(p => p.id === selected[0].id)!;
    const scale = design.params.scale;
    const raw = (intent.type === "hole" ? intent.diameter : intent.value) / scale;
    if (!Number.isFinite(raw) || raw <= 0) throw new DesignError("Enter a positive finite dimension.");
    if (intent.type === "dimension") {
      const axis = intent.axis === "x" ? 0 : intent.axis === "y" ? 1 : 2;
      if (!["x", "y", "z"].includes(intent.axis)) throw new DesignError("Unknown dimension axis.");
      if (part.shape === "box") part.size[axis] = raw;
      else if (axis === 1) {
        if (part.sections) { const ratio = raw / part.size[1]; part.sections.forEach(s => s.height *= ratio); }
        part.size[1] = raw;
      } else if (part.loopSpan !== undefined) {
        if (axis === 0) { part.loopSpan = raw - part.size[2]; part.size[0] = raw; }
        else { part.size[2] = raw; part.size[0] = part.loopSpan + raw; }
      } else {
        const ratio = raw / part.size[0];
        part.sections?.forEach(s => s.diameter *= ratio);
        part.size[0] = part.size[2] = raw;
      }
      description = `${part.name}: local ${intent.axis.toUpperCase()} dimension → ${intent.value} mm`;
    } else if (intent.type === "wallThickness") {
      if (part.shape !== "tube" || part.sections) throw new DesignError("Wall thickness editing requires an unstepped tube.", "UNSUPPORTED_EDIT");
      part.holeDiameter = part.size[2] - 2 * raw;
      description = `${part.name}: wall thickness → ${intent.value} mm`;
    } else {
      if (intent.holeIndex === "bore") {
        if (part.shape !== "tube" || part.sections) throw new DesignError("Select a supported tube bore.", "UNSUPPORTED_EDIT");
        part.holeDiameter = raw;
      } else {
        if (!Number.isInteger(intent.holeIndex) || !part.holes?.[intent.holeIndex]) throw new DesignError("That hole is no longer available.", "STALE_SELECTION");
        part.holes[intent.holeIndex].diameter = raw;
      }
      description = `${part.name}: ${intent.holeIndex === "bore" ? "inner" : `hole ${intent.holeIndex + 1}`} diameter → ${intent.diameter} mm`;
    }
    design.customParts = customParts;
  }
  // The same generator used by CAD/BOM/assembly exports validates all changes.
  const derived = deriveDesign(design);
  const before = new Map(snapshot.derived.parts.map(p => [p.id, p]));
  const after = new Map(derived.parts.map(p => [p.id, p]));
  const affectedPartIds = [...new Set([...before.keys(), ...after.keys()])].filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
  const command: Command = { id: crypto.randomUUID(), actor, baseRevision: design.revision,
    changes, readSet: customParts ? { ...snapshot.design.params } : readSetFor(snapshot.design, changes),
    ...(customParts ? { customParts } : {}), summary: description };
  return { command, preview: { ...snapshot, design, derived }, affectedPartIds,
    explanation: `${description}. ${affectedPartIds.length} part${affectedPartIds.length === 1 ? "" : "s"} change after regeneration. Review the proposed geometry before accepting.` };
}
