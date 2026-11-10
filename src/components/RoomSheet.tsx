import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Smartphone, X } from "lucide-react";
import QRCode from "qrcode";
import { api, recent } from "../lib/api";
import { useDialog } from "../lib/useDialog";
import { RoomModel, modelUrl, useModelState, viewPath } from "../ViewInRoom";
import type { BuildJob } from "../shared/types";
import "./room.css";

/**
 * "See it in your room": a 3D preview of the built model and a code a phone can scan to
 * open it straight in AR. The code carries a view-only link, never the editing link.
 */
export default function RoomSheet({ designId, token, readOnly, onClose }: {
  designId: string;
  /** The link this studio was opened with: used to read the model and, for editors, to build it. */
  token: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  useDialog(true, onClose);
  // A view-only capability: the viewer's own link, or the one this browser saved when it created the design.
  const viewToken = readOnly ? token : recent().find(r => r.id === designId)?.viewerToken || "";
  const [refresh, setRefresh] = useState(0);
  const { state, revision } = useModelState(designId, token, refresh);
  const [qr, setQr] = useState(""), [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(false), [error, setError] = useState("");
  const link = viewToken ? location.origin + viewPath(designId, viewToken) : "";
  useEffect(() => {
    if (!link) return;
    let stop = false;
    QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 240, color: { dark: "#132344", light: "#FFFFFF" } })
      .then(url => { if (!stop) setQr(url); }).catch(() => { if (!stop) setQr(""); });
    return () => { stop = true; };
  }, [link]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function build() {
    setBuilding(true); setError("");
    try {
      let job = await api<BuildJob>("/designs/" + designId + "/build", token, {});
      while (alive.current && (job.status === "queued" || job.status === "running")) {
        await new Promise(r => setTimeout(r, 1200));
        job = await api<BuildJob>("/builds/" + job.id, token);
      }
      if (job.status !== "ready") throw new Error(job.error || "The model could not be prepared.");
      if (alive.current) setRefresh(n => n + 1);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBuilding(false); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal room-sheet" role="dialog" aria-modal="true" aria-labelledby="room-title" onClick={e => e.stopPropagation()} data-testid="room-sheet">
        <div className="panel-heading">
          <h2 id="room-title">See it in your room</h2>
          <button className="button icon-only" aria-label="Close room view" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="room-sheet-body">
          <div className="room-sheet-preview">
            {state === "ready" ? <RoomModel src={modelUrl(designId, token)} ar={false} label="Real-size preview of this design" />
              : state === "loading" ? <div className="room-model is-loading" role="status"><Loader2 className="spin" size={22} /> Checking the model…</div>
              : <div className="room-model is-empty" role="status">
                  <p>{state === "missing" ? "The 3D model is made with the build files." : "The model could not be loaded."}</p>
                  {state === "missing" && !readOnly && <button className="button primary" disabled={building} onClick={() => void build()}>
                    {building ? <><Loader2 className="spin" size={16} /> Preparing the model…</> : "Prepare the 3D model"}</button>}
                  {error && <p className="error" role="alert">{error}</p>}
                </div>}
          </div>
          <div className="room-sheet-phone">
            {link ? <>
              {qr ? <img className="room-qr" src={qr} width={240} height={240} alt="Code to open this design in AR on a phone" /> : <div className="room-qr" />}
              <p className="room-scan"><Smartphone size={16} aria-hidden="true" /> Scan with your phone camera. It opens this design at real size in your room, on iPhone and Android.</p>
              {/* On a phone the code is not needed: open the room view here. */}
              <a className="button primary room-open-link" href={link}>Open it in your room</a>
              <button className="button small" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Link copied" : "Copy view link"}</button>
              <p className="subtle">The code and the link are view-only.{revision !== null && state === "ready" ? ` Model from revision ${revision}.` : ""}</p>
            </> : <p className="subtle">The view-only link is available in the browser that created this design. Open the design there to show the code.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
