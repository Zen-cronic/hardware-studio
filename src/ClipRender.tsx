import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { featuredGeometry } from "./lib/partGeometry";
import { motionPose } from "./lib/motion";
import { explodedParts } from "./lib/explosion";
import { evaluateClipFrame, type ClipProject } from "./lib/clip-timeline";
import { colors } from "./lib/tokens";

interface FrameReceipt { frame: number; revision: number; snapshotHash: string }
declare global {
  interface Window {
    loadClipProject?: (project: ClipProject) => Promise<FrameReceipt>;
    setClipFrame?: (frame: number) => Promise<FrameReceipt>;
    clipRenderInfo?: FrameReceipt;
    clipRenderError?: string;
  }
}
class ProductScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 16 / 9, .1, 200000);
  parts = new Map<string, THREE.Mesh>();
  resources: { dispose: () => void }[] = [];
  constructor(canvas: HTMLCanvasElement, readonly project: ClipProject) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(project.format.width, project.format.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.camera.aspect = project.format.width / project.format.height;
    this.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color(colors.surface);
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(room, .04);
    this.scene.environment = environment.texture;
    this.scene.environmentIntensity = .65;
    this.resources.push(environment); room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.AmbientLight(colors.white, .45));
    const key = new THREE.DirectionalLight(colors.white, 2); key.position.set(2, 3, 2); this.scene.add(key);
    const fill = new THREE.DirectionalLight(colors.white, .8); fill.position.set(-2, 2, -1); this.scene.add(fill);
    for (const part of project.snapshot.derived.parts) {
      const geometry = part.shape === "box" && !part.holes?.length && !part.channel
        ? new THREE.BoxGeometry(...part.size)
        : part.shape === "cylinder" && !part.sections && !part.holes?.length
          ? new THREE.CylinderGeometry(part.size[0] / 2, part.size[0] / 2, part.size[1], 64)
          : featuredGeometry(part);
      const metal = /steel|alumin|metal/i.test(part.material), reference = part.role === "reference";
      const material = new THREE.MeshStandardMaterial({ color: part.color,
        metalness: metal ? .65 : .02, roughness: metal ? .4 : .74,
        transparent: reference || /water|glass/i.test(part.material), opacity: reference ? .28 : /water|glass/i.test(part.material) ? .55 : 1,
        depthWrite: !reference });
      const mesh = new THREE.Mesh(geometry, material); mesh.userData.partId = part.id;
      const edgeGeometry = new THREE.EdgesGeometry(geometry, 28);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: colors.text, transparent: true, opacity: .2 });
      mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      this.parts.set(part.id, mesh); this.scene.add(mesh);
      this.resources.push(geometry, material, edgeGeometry, edgeMaterial);
    }
  }
  render(frame: number) {
    const state = evaluateClipFrame(this.project, frame), parts = explodedParts(this.project.snapshot.derived.parts, state.explosion);
    for (const part of parts) {
      const pose = motionPose(part, parts, state.mechanismSeconds), mesh = this.parts.get(part.id)!;
      mesh.position.set(...pose.position); mesh.rotation.set(...pose.rotation);
    }
    const viewHeight = Math.round(this.project.format.height * state.camera.viewportHeight);
    this.renderer.setViewport(0, this.project.format.height - viewHeight, this.project.format.width, viewHeight);
    this.camera.aspect = this.project.format.width / viewHeight; this.camera.updateProjectionMatrix();
    this.camera.position.set(...state.camera.position); this.camera.lookAt(...state.camera.target);
    this.camera.updateMatrixWorld(); this.scene.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.getContext().finish();
  }
  dispose() { this.resources.forEach(resource => resource.dispose()); this.renderer.dispose(); }
}
export function ClipPreview({ project, frame, onRendered }: { project: ClipProject; frame: number; onRendered?: (receipt: FrameReceipt) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), scene = useRef<ProductScene | null>(null);
  const [error, setError] = useState("");
  const state = evaluateClipFrame(project, frame);
  useLayoutEffect(() => {
    try {
      scene.current = new ProductScene(canvas.current!, project); setError(""); window.clipRenderError = undefined;
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "3D rendering is unavailable.";
      setError(message); window.clipRenderError = message;
    }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [project]);
  useLayoutEffect(() => {
    if (!scene.current) return;
    try {
      scene.current.render(frame);
      canvas.current!.dataset.frame = String(frame);
      canvas.current!.dataset.snapshotHash = project.snapshotHash;
      const receipt = { frame, revision: project.snapshot.design.revision, snapshotHash: project.snapshotHash };
      window.clipRenderInfo = receipt; onRendered?.(receipt);
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : "This frame could not be rendered.";
      setError(message); window.clipRenderError = message;
    }
  }, [project, frame, onRendered]);
  return <div id="clip-stage" aria-label="Product video preview" style={{ width: "100%", aspectRatio: `${project.format.width}/${project.format.height}`, position: "relative", overflow: "hidden", containerType: "inline-size", background: colors.surface }}>
    <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
    <div style={{ position: "absolute", left: "4.5%", bottom: "5.5%", maxWidth: "65%", color: colors.text, opacity: state.captionOpacity }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "3.3cqw", lineHeight: 1.12, letterSpacing: "-.035em", margin: "0 0 1cqw", textWrap: "balance", overflowWrap: "anywhere", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>{state.title}</h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: "1.35cqw", margin: 0, lineHeight: 1.4 }}>{state.subtitle}</p>
    </div>
    <div style={{ position: "absolute", right: "4.5%", top: "5%", fontFamily: "var(--font-display)", color: colors.text, fontWeight: 600, fontSize: "1.2cqw" }}>Hardware Studio</div>
    {error && <p role="alert" style={{ position: "absolute", inset: "40% 10%", background: colors.panel, color: colors.danger, padding: 20 }}>Video preview unavailable. {error}</p>}
  </div>;
}
async function afterPaint() {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (window.clipRenderError) throw new Error(window.clipRenderError);
  if (!window.clipRenderInfo) throw new Error("The renderer did not produce a frame.");
  return window.clipRenderInfo;
}
export default function ClipRender() {
  const [project, setProject] = useState<ClipProject | null>(null), [frame, setFrame] = useState(0);
  const current = useRef<ClipProject | null>(null);
  useEffect(() => {
    window.loadClipProject = async input => {
      if (input.version !== 1 || input.snapshot.derived.parts.length < 1 || input.snapshot.derived.parts.length > 256) throw new Error("Unsupported clip project.");
      evaluateClipFrame(input, 0);
      current.current = input; window.clipRenderInfo = undefined; window.clipRenderError = undefined;
      flushSync(() => { setProject(input); setFrame(0); });
      return afterPaint();
    };
    window.setClipFrame = async next => {
      if (!current.current) throw new Error("Load a frozen clip project first.");
      evaluateClipFrame(current.current, next);
      flushSync(() => setFrame(next));
      const receipt = await afterPaint();
      if (receipt.frame !== next || receipt.snapshotHash !== current.current.snapshotHash) throw new Error("The rendered frame does not match the requested snapshot.");
      return receipt;
    };
    return () => { delete window.loadClipProject; delete window.setClipFrame; delete window.clipRenderInfo; delete window.clipRenderError; };
  }, []);
  return <main style={{ position: "fixed", inset: 0, overflow: "hidden", background: colors.surface }}>
    {project ? <ClipPreview project={project} frame={frame} /> : <p role="status" style={{ padding: 24, color: colors.text }}>Waiting for the video renderer.</p>}
  </main>;
}
