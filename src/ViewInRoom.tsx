import { useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Loader2 } from "lucide-react";
import { tokenFromUrl } from "./lib/api";
import "./components/room.css";

// The in-room viewer: the built assembly at real size, placed through the phone's own AR viewer.
// model-viewer ships its own copy of three inside this lazily loaded bundle.
const loadViewer = () => import("@google/model-viewer/dist/model-viewer.min.js");

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

export const modelUrl = (id: string, token: string) => `/api/designs/${encodeURIComponent(id)}/model.glb?token=${encodeURIComponent(token)}`;
export const viewPath = (id: string, token: string) => `/view/${encodeURIComponent(id)}#token=${encodeURIComponent(token)}`;

type State = "loading" | "ready" | "missing" | "denied" | "error";
/** Checks the model exists before handing its URL to the viewer, so the page can explain a gap. */
export function useModelState(id: string, token: string, refresh = 0) {
  const [state, setState] = useState<State>("loading");
  const [revision, setRevision] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    setState("loading");
    fetch(modelUrl(id, token), { method: "HEAD", cache: "no-store" }).then(r => {
      if (stop) return;
      setRevision(r.headers.get("X-Model-Revision"));
      setState(r.ok ? "ready" : r.status === 409 ? "missing" : r.status === 403 || r.status === 404 ? "denied" : "error");
    }).catch(() => { if (!stop) setState("error"); });
    return () => { stop = true; };
  }, [id, token, refresh]);
  return { state, revision };
}

/** model-viewer element with real-size AR on Android (Scene Viewer or WebXR) and iPhone (Quick Look). */
export function RoomModel({ src, ar = true, label, onLoad }: { src: string; ar?: boolean; label: string; onLoad?: () => void }) {
  const [ready, setReady] = useState(false);
  const element = useRef<HTMLElement | null>(null), loaded = useRef(onLoad); loaded.current = onLoad;
  useEffect(() => { let stop = false; void loadViewer().then(() => { if (!stop) setReady(true); }); return () => { stop = true; }; }, []);
  // Attributes, not React properties: model-viewer reads them as documented, and an empty "ar" property would be false.
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const attributes: Record<string, string> = { src, alt: label, "camera-controls": "", "touch-action": "pan-y", "shadow-intensity": "0.8", exposure: "1.35", "environment-image": "neutral",
      ...(ar ? { ar: "", "ar-modes": "webxr scene-viewer quick-look", "ar-scale": "fixed", "ar-placement": "floor" } : {}) };
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    if (!ar) for (const name of ["ar", "ar-modes", "ar-scale", "ar-placement"]) el.removeAttribute(name);
    const on = () => loaded.current?.();
    el.addEventListener("load", on);
    return () => el.removeEventListener("load", on);
  }, [ready, src, ar, label]);
  if (!ready) return <div className="room-model is-loading" role="status"><Loader2 className="spin" size={22} /> Loading the 3D viewer…</div>;
  return <model-viewer class="room-model" ref={element}>
    {ar && <button slot="ar-button" className="button primary room-ar-button" type="button">View in your space</button>}
  </model-viewer>;
}

export default function ViewInRoom({ id }: { id: string }) {
  const token = tokenFromUrl();
  const { state, revision } = useModelState(id, token);
  return (
    <main className="room-page">
      <header className="room-header">
        <a className="brand" href="/" aria-label="Hardware Studio home"><span className="brand-mark"><Box size={21} strokeWidth={1.5} /></span><span>Hardware Studio</span></a>
        <h1>See it in your room</h1>
      </header>
      {state === "ready" ? <>
        <RoomModel src={modelUrl(id, token)} label="The design at real size" />
        <p className="room-hint">Tap <strong>View in your space</strong>, point your phone at the floor or a table, and it appears at real size. Drag to move it, pinch to turn it.{revision !== null && <> Built from revision {revision}.</>}</p>
      </> : state === "loading" ? <div className="room-status" role="status"><Loader2 className="spin" size={24} /> Preparing the model…</div>
        : <div className="room-status" role="alert"><AlertCircle size={24} />
          <p>{state === "missing" ? "This design has no 3D model yet. Open it on a computer, choose Build, then Generate build package, and scan the code again."
            : state === "denied" ? "This link is not valid. Ask for a new view link." : "The model could not be loaded. Check your connection and try again."}</p>
        </div>}
    </main>
  );
}
