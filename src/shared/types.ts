export type ProductKind =
  | "turntable"
  | "slider"
  | "conveyor"
  | "lamp"
  | "planter"
  | "holder"
  | "custom";
export type Vec3 = [number, number, number];
export interface ParameterSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  description: string;
}
export interface ProductDefinition {
  kind: ProductKind;
  name: string;
  category: string;
  description: string;
  story: string;
  parameters: ParameterSpec[];
  accent: string;
}
export interface Motion {
  type: "rotate" | "slide" | "pivot" | "flow";
  axis: "x" | "y" | "z";
  speed: number;
  range?: number;
  drivenBy?: string;
  travelPerTurn?: number;
}
export interface Part {
  id: string;
  name: string;
  shape: "box" | "cylinder" | "tube";
  size: Vec3;
  position: Vec3;
  rotation?: Vec3;
  holeDiameter?: number;
  // Tube-only capsule loop in X/Z; end-circle centres separated along local X.
  // size = [loopSpan + outer bend diameter, axial width, outer bend diameter].
  // holeDiameter is the inner bend diameter. Smooth clearance envelope, no teeth.
  loopSpan?: number;
  // Coaxial sections, bottom to top; total height and maximum OD match size.
  sections?: { height: number; diameter: number; bore: number }[];
  // Through holes along local Y, with centres in local X/Z.
  holes?: {
    x: number;
    z: number;
    diameter: number;
    counterbore?: { diameter: number; depth: number };
  }[];
  // Box-only: centered underside relief, full local X length; width along Z.
  channel?: { width: number; depth: number };
  color: string;
  material: string;
  role?: "component" | "reference";
  process: "print" | "machine" | "buy" | "cut";
  motion?: Motion;
  parentId?: string;
}
// World coordinates: millimetres, Y up; Euler rotations in radians, XYZ order.
// Cylinder/tube size = [outer diameter, axial height, outer diameter]; axis Y.
// Tube holeDiameter is a through bore along Y. All positions are part centres.
export interface BomItem {
  id: string;
  name: string;
  quantity: number;
  material: string;
  process: string;
  specification: string;
  sourceUrl?: string;
}
export interface AssemblyStep {
  id: string;
  title: string;
  instruction: string;
  partIds: string[];
  check: string;
}
export interface Metric {
  label: string;
  value: number | string;
  unit?: string;
}
export interface Connection {
  from: string;
  to: string;
  description: string;
}
export interface DerivedDesign {
  parts: Part[];
  bom: BomItem[];
  steps: AssemblyStep[];
  connections: Connection[];
  metrics: Metric[];
  warnings: string[];
}
export interface Design {
  id: string;
  kind: ProductKind;
  name: string;
  revision: number;
  mechanismVersion?: 2;
  params: Record<string, number>;
  customParts?: Part[];
  createdAt: string;
  updatedAt: string;
}
export interface HistoryEntry {
  id: string;
  actor: string;
  revision: number;
  summary: string;
  at: string;
  changes: Record<string, number>;
  before: Record<string, number>;
}
export interface Snapshot {
  design: Design;
  derived: DerivedDesign;
  history: HistoryEntry[];
  role?: "editor" | "viewer";
}
export interface Access {
  editorToken: string;
  viewerToken: string;
}
export interface Command {
  id: string;
  baseRevision: number;
  actor: string;
  changes: Record<string, number>;
  readSet: Record<string, number>;
  customParts?: Part[];
  summary?: string;
  undoOf?: string;
}
export interface Proposal {
  command: Command;
  explanation: string;
  source: "ai" | "local";
  questions?: string[];
}
export interface BuildJob {
  id: string;
  designId: string;
  revision: number;
  status: "queued" | "running" | "ready" | "failed";
  downloadUrl?: string;
  error?: string;
}
export interface Presence {
  clientId: string;
  name: string;
  color: string;
  selection?: string;
  camera?: { position: Vec3; target: Vec3 };
}
export type RoomEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "presence"; peers: Presence[] }
  | { type: "error"; message: string };
