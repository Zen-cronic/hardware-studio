import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, Video } from "lucide-react";
import type { Snapshot } from "../shared/types";
import { api } from "../lib/api";
import { CLIP_FORMAT, makeClipProject, type ClipJob, type ClipProject } from "../lib/clip-timeline";
import { ClipPreview } from "../ClipRender";

export default function ClipWorkbench({ snapshot, token }: { snapshot: Snapshot; token: string }) {
  const current = useMemo(() => makeClipProject(snapshot, "preview"), [snapshot.design.id, snapshot.design.revision]);
  const [jobs, setJobs] = useState<ClipJob[]>([]), [selectedId, setSelectedId] = useState("");
  const [savedProject, setSavedProject] = useState<ClipProject | null>(null), [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const project = savedProject || current, total = project.format.durationSeconds * project.format.fps;
  const selected = jobs.find(job => job.id === selectedId), editable = snapshot.role !== "viewer";
  const playStart = useRef({ time: 0, frame: 0 });
  const refresh = useCallback(async () => {
    setJobs(await api<ClipJob[]>(`/designs/${snapshot.design.id}/clips`, token));
  }, [snapshot.design.id, token]);
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const value = await api<ClipJob[]>(`/designs/${snapshot.design.id}/clips`, token); if (alive) setJobs(value); } catch (issue) { if (alive) setError(issue instanceof Error ? issue.message : "Could not load video exports."); } };
    void poll(); const interval = setInterval(() => void poll(), 2000);
    return () => { alive = false; clearInterval(interval); };
  }, [snapshot.design.id, token]);
  useEffect(() => {
    let alive = true; setPlaying(false); setFrame(0); setSavedProject(null);
    if (selectedId) void api<ClipProject>(`/clips/${selectedId}/project`, token).then(value => { if (alive) setSavedProject(value); }).catch(issue => { if (alive) setError(issue.message); });
    return () => { alive = false; };
  }, [selectedId, token, current]);
  useEffect(() => {
    if (!playing) return;
    playStart.current = { time: performance.now(), frame };
    let handle = 0;
    const tick = (time: number) => {
      const next = playStart.current.frame + Math.floor((time - playStart.current.time) * project.format.fps / 1000);
      if (next >= total) { setFrame(total - 1); setPlaying(false); return; }
      setFrame(next); handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick); return () => cancelAnimationFrame(handle);
  }, [playing, project, total]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); try { await work(); } catch (issue) { setError(issue instanceof Error ? issue.message : "The video action failed."); } finally { setBusy(false); }
  };
  const exportClip = () => action(async () => {
    const job = await api<ClipJob>(`/designs/${snapshot.design.id}/clips`, token, { revision: snapshot.design.revision });
    await refresh(); setSelectedId(job.id);
  });
  const download = (job: ClipJob) => action(async () => {
    const response = await fetch(`/api/clips/${job.id}/download`, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) { let message = "Could not download this video."; try { message = (await response.json()).error || message; } catch {} throw new Error(message); }
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `make-anything-r${job.revision}.mp4`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  return <section className="clip-workbench" aria-labelledby="clip-heading" style={{ padding: "16px 0", maxWidth: 1440, margin: "0 auto" }}>
    <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
      <div><h2 id="clip-heading">Show your product in motion</h2><p>A 20-second film showing the design, assembly and camera views.</p></div>
      <button className="button primary" disabled={busy || !editable} onClick={() => void exportClip()}><Video size={18}/>Create video from revision {snapshot.design.revision}</button>
    </div>
    {error && <p className="workspace-alert error" role="alert">{error}</p>}
    <label className="study-field" style={{ maxWidth: 480, marginBottom: 16 }}>Preview<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
      <option value="">Current design — revision {snapshot.design.revision}</option>
      {jobs.map(job => <option key={job.id} value={job.id}>Revision {job.revision} — {job.status}{job.stale ? " — earlier design" : ""}</option>)}
    </select></label>
    {selectedId && !savedProject ? <p role="status">Loading the saved video design…</p> : <ClipPreview project={project} frame={Math.min(frame, total - 1)}/>}
    <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "16px 0" }}>
      <button className="button" disabled={!!selectedId && !savedProject} aria-label={playing ? "Pause video preview" : "Play video preview"} onClick={() => { if (!playing && frame === total - 1) setFrame(0); setPlaying(value => !value); }}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <input aria-label="Video frame" type="range" min={0} max={total - 1} step={1} value={frame} onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }} style={{ flex: 1, minWidth: 0 }}/>
      <output className="mono" style={{ minWidth: 100 }}>{(frame / project.format.fps).toFixed(1)} / {project.format.durationSeconds}s</output>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
      {project.shots.map((shot, index) => <button className="button" key={shot.startFrame} onClick={() => { setPlaying(false); setFrame(shot.startFrame); }} style={{ display: "block", textAlign: "left", whiteSpace: "normal" }}><span className="mono">{(shot.startFrame / project.format.fps).toFixed(0)}s</span><br/>{["Orbit", "Exploded assembly", "Working mechanism", "Product hero"][index]}</button>)}
    </div>
    <p className="subtle">{CLIP_FORMAT.width} × {CLIP_FORMAT.height} MP4, {CLIP_FORMAT.fps} frames per second. Every export keeps the exact saved revision. Later edits won’t change an existing video.</p>
    {selected && <article className="study-result" aria-live="polite">
      <h3>Revision {selected.revision} video{selected.stale ? " — earlier design" : ""}</h3>
      {selected.status === "running" || selected.status === "queued" ? <><p>{selected.status === "queued" ? "Waiting for the video renderer" : `Rendering frame ${selected.frame} of ${selected.totalFrames}`}</p><progress max={selected.totalFrames} value={selected.frame} aria-label="Video export progress" style={{ width: "100%" }}/><button className="button" disabled={busy || !editable} onClick={() => void action(async () => { await api(`/clips/${selected.id}/cancel`, token, {}); await refresh(); })}>Cancel export</button></> : selected.status === "ready" ? <button className="button primary" disabled={busy} onClick={() => void download(selected)}><Download size={18}/>Download MP4</button> : <p>{selected.error || "Export cancelled. You can create another video when you’re ready."}</p>}
    </article>}
    {!jobs.length && <p className="subtle">Your exported videos will appear here.</p>}
  </section>;
}
