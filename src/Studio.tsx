import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  Layers3,
  Loader2,
  MessageSquare,
  Mic,
  Move3D,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RotateCcw,
  Ruler,
  Send,
  Settings2,
  Share2,
  Undo2,
  Users,
  X,
  Box,
  AlertCircle,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import type {
  Access,
  BuildJob,
  Command,
  Design,
  Part,
  Presence,
  Proposal,
  Snapshot,
  Vec3,
} from "./shared/types";
import { CATALOG, getProduct } from "./shared/catalog";
import { readSetFor } from "./shared/engine";
import {
  api,
  uid,
  tokenFromUrl,
  recent,
  remember,
  getActor,
  setActor,
  pathFor,
} from "./lib/api";
import ModelCanvas from "./components/ModelCanvas";
import SharedNotes from "./components/SharedNotes";
import ReferenceInput, { VoiceButton } from "./components/ReferenceInput";
import { Brand, type Navigate } from "./App";
import { colors } from "./lib/tokens";
import { useDialog } from "./lib/useDialog";
type Tab = "design" | "assemble" | "build";
export default function Studio({
  id,
  navigate,
}: {
  id: string;
  navigate: Navigate;
}) {
  const token = useMemo(tokenFromUrl, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [actor, changeActor] = useState(getActor),
    [peers, setPeers] = useState<Presence[]>([]),
    [connected, setConnected] = useState(false),
    [tab, setTab] = useState<Tab>("design");
  const [selected, setSelected] = useState(""),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [exploded, setExploded] = useState(false),
    [dimensions, setDimensions] = useState(false),
    [reset, setReset] = useState(0);
  const [prompt, setPrompt] = useState(""),
    [image, setImage] = useState(""),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [promptBusy, setPromptBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Record<string, number>>({}),
    [base, setBase] = useState<Design | null>(null),
    [share, setShare] = useState(false),
    [notes, setNotes] = useState(false),
    [fit, setFit] = useState(false),
    [fitWidth, setFitWidth] = useState(100),
    [fitHeight, setFitHeight] = useState(80);
  const [practice, setPractice] = useState(0),
    [mobileEditor, setMobileEditor] = useState<"dimensions" | "prompt">(
      "dimensions",
    );
  const [leftPanelOpen, setLeftPanelOpen] = useState(true),
    [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [step, setStep] = useState(0),
    [completed, setCompleted] = useState<string[]>([]),
    [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null),
    [follow, setFollow] = useState(""),
    [newPart, setNewPart] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const clientId = useRef(uid());
  const mounted = useRef(true);
  const product = snapshot ? getProduct(snapshot.design.kind) : undefined;
  const readOnly = snapshot?.role === "viewer";
  function acceptSnapshot(incoming: Snapshot) {
    setSnapshot((previous) =>
      !previous || incoming.design.revision >= previous.design.revision
        ? incoming
        : previous,
    );
  }
  async function reload() {
    setLoading(true);
    setError("");
    try {
      acceptSnapshot(await api<Snapshot>("/designs/" + id, token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [id, token]);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let socket: WebSocket;
    let stopped = false;
    const connect = () => {
      socket = new WebSocket(
        (location.protocol === "https:" ? "wss:" : "ws:") +
          "//" +
          location.host +
          "/api/rooms/" +
          encodeURIComponent(id) +
          "?token=" +
          encodeURIComponent(token) +
          "&clientId=" +
          clientId.current +
          "&name=" +
          encodeURIComponent(actor),
      );
      ws.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "snapshot") acceptSnapshot(m.snapshot);
          if (m.type === "presence") setPeers(m.peers);
          if (m.type === "error") setError(m.message);
        } catch {}
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) timer = setTimeout(connect, 2500);
      };
      socket.onerror = () => setConnected(false);
    };
    if (token) connect();
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(timer);
      socket?.close();
    };
  }, [id, token, actor]);
  useEffect(() => {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(
        JSON.stringify({ type: "presence", selection: selected }),
      );
  }, [selected, connected]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = setTimeout(async () => {
      try {
        setJob(await api<BuildJob>("/builds/" + job.id, token));
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [job, token]);
  useEffect(() => {
    setCheck(null);
    setCompleted([]);
  }, [snapshot?.design.revision]);
  useEffect(() => {
    setPractice(0);
    setCheck(null);
  }, [selected, step, snapshot?.design.revision]);
  function cameraChanged(camera: { position: Vec3; target: Vec3 }) {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(
        JSON.stringify({ type: "presence", selection: selected, camera }),
      );
  }
  const others = peers.filter((p) => p.clientId !== clientId.current);
  const following = others.find((p) => p.clientId === follow);
  async function run(body: Command) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Snapshot>(
        "/designs/" + id + "/commands",
        token,
        body,
      );
      acceptSnapshot(result);
      setDraft({});
      setBase(null);
      setProposal(null);
      setNotice("Design updated. Parts and assembly now match.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(key: string, value: number) {
    if (!base && snapshot) setBase(structuredClone(snapshot.design));
    setDraft((prev) => ({ ...prev, [key]: value }));
    setNotice("");
  }
  async function applyDraft() {
    if (!snapshot) return;
    const original = base || snapshot.design;
    await run({
      id: uid(),
      actor,
      baseRevision: original.revision,
      changes: draft,
      readSet: readSetFor(original, draft),
      summary:
        "Updated " +
        Object.keys(draft)
          .map((k) => product?.parameters.find((p) => p.key === k)?.label || k)
          .join(", "),
    });
  }
  async function propose() {
    if (!snapshot || !prompt.trim()) return;
    setPromptBusy(true);
    setError("");
    setNotice("");
    try {
      const p = await api<Proposal>("/designs/" + id + "/propose", token, {
        prompt,
        actor,
        ...(image ? { image } : {}),
      });
      setProposal(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPromptBusy(false);
    }
  }
  async function undo() {
    if (!snapshot) return;
    const item = [...snapshot.history].reverse().find((h) => h.actor === actor);
    if (!item) {
      setNotice("There are no changes by you to undo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      acceptSnapshot(
        await api<Snapshot>("/designs/" + id + "/undo", token, {
          actor,
          id: uid(),
          operationId: item.id,
        }),
      );
      setDraft({});
      setBase(null);
      setNotice("Your change was undone.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function build() {
    setBusy(true);
    setError("");
    try {
      setJob(await api<BuildJob>("/designs/" + id + "/build", token, {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function fork() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ snapshot: Snapshot; access: Access }>(
        "/designs/" + id + "/fork",
        token,
        {},
      );
      remember(r.snapshot, r.access);
      navigate(pathFor(r.snapshot.design.id, r.access.editorToken));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeStep(next: number) {
    setStep(next);
    setCheck(null);
    setSelected("");
    setPlaying(false);
    setExploded(true);
  }
  if (loading && !snapshot)
    return (
      <div className="full-status">
        <Loader2 className="spin" size={28} />
        <h2>Opening your workspace…</h2>
      </div>
    );
  if (!snapshot)
    return (
      <div className="full-status">
        <AlertCircle size={28} />
        <h2>This design couldn’t be opened.</h2>
        <p role="alert">
          {error || "Open an invitation link or create your own design."}
        </p>
        <div className="row">
          <button className="button" onClick={() => void reload()}>
            Try again
          </button>
          <button className="button primary" onClick={() => navigate("/")}>
            Back to designs
          </button>
        </div>
      </div>
    );
  const { design, derived, history } = snapshot;
  const visibleParts =
    tab === "assemble" && selected && practice
      ? derived.parts.map((p) =>
          p.id === selected
            ? {
                ...p,
                rotation: [
                  p.rotation?.[0] || 0,
                  p.rotation?.[1] || 0,
                  (p.rotation?.[2] || 0) + (practice * Math.PI) / 2,
                ] as Vec3,
              }
            : p,
        )
      : derived.parts;
  const currentStep = derived.steps[Math.min(step, derived.steps.length - 1)];
  const chosen = derived.parts.find((p) => p.id === selected);
  const pending = Object.keys(draft).length > 0;
  const myHistory = [...history].reverse();
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <Brand onClick={() => navigate("/")} />
        <span className="header-divider" />
        <div className="design-title">
          <h1>{design.name}</h1>
          <span>
            <span className={"connection-dot " + (connected ? "online" : "")} />
            {connected ? "Saved together" : "Reconnecting…"} · Revision{" "}
            {design.revision}
          </span>
        </div>
        <div className="studio-header-actions">
          <div
            className="peer-group"
            aria-label={peers.length + " people in this workspace"}
          >
            {others.slice(0, 3).map((p) => (
              <span
                className="avatar"
                style={{ background: p.color }}
                key={p.clientId}
                title={p.name}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            <span className="avatar self" title={actor}>
              {actor.slice(0, 1).toUpperCase()}
            </span>
          </div>
          <button
            className={"button icon-only " + (notes ? "selected" : "")}
            aria-label="Open shared notes"
            title="Shared notes"
            aria-expanded={notes}
            aria-controls="shared-notes-drawer"
            onClick={() => setNotes(!notes)}
          >
            <MessageSquare size={18} />
          </button>
          <button className="button small" onClick={() => setShare(true)}>
            <Share2 size={16} />
            <span>Share</span>
          </button>
          <button
            className="button primary small"
            onClick={() => setTab("build")}
          >
            <Download size={16} />
            <span>Build files</span>
          </button>
        </div>
      </header>
      <div className="workspace-bar">
        <button
          className="button quiet small"
          onClick={() => navigate("/work")}
        >
          <ArrowLeft size={15} /> Your work
        </button>
        <div className="workspace-tabs" role="tablist" aria-label="Workspace">
          <button
            role="tab"
            aria-selected={tab === "design"}
            className={tab === "design" ? "active" : ""}
            onClick={() => setTab("design")}
          >
            <Settings2 size={16} /> Design
          </button>
          <button
            role="tab"
            aria-selected={tab === "assemble"}
            className={tab === "assemble" ? "active" : ""}
            onClick={() => {
              setTab("assemble");
              setExploded(true);
              setPlaying(false);
            }}
          >
            <Layers3 size={16} /> Assemble
          </button>
          <button
            role="tab"
            aria-selected={tab === "build"}
            className={tab === "build" ? "active" : ""}
            onClick={() => setTab("build")}
          >
            <PackageOpen size={16} /> Build
          </button>
        </div>
        <button
          className="button quiet small"
          onClick={() => void fork()}
          disabled={busy}
        >
          <Copy size={15} /> Make a copy
        </button>
      </div>
      {error && (
        <div className="workspace-alert error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button
            className="button small"
            onClick={() => {
              setError("");
              setDraft({});
              setBase(null);
              void reload();
            }}
          >
            Review latest design
          </button>
          <button
            aria-label="Dismiss error"
            className="button icon-only"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {readOnly && (
        <div className="workspace-alert">
          <Eye size={16} />
          <span>You can explore this design. Make a copy to change it.</span>
        </div>
      )}
      <div className="panel-visibility-controls" role="group" aria-label="Side panels">
        <button
          className="button small"
          aria-label={leftPanelOpen ? "Collapse left panel" : "Expand left panel"}
          aria-expanded={leftPanelOpen}
          aria-controls="studio-left-panel"
          onClick={() => setLeftPanelOpen((open) => !open)}
        >
          {leftPanelOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          Left panel
        </button>
        <button
          className="button small"
          aria-label={rightPanelOpen ? "Collapse right panel" : "Expand right panel"}
          aria-expanded={rightPanelOpen}
          aria-controls="studio-right-panel"
          onClick={() => setRightPanelOpen((open) => !open)}
        >
          Right panel
          {rightPanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </div>
      <main
        className={
          "studio-main " +
          (!leftPanelOpen ? " left-panel-collapsed " : "") +
          (!rightPanelOpen ? " right-panel-collapsed " : "") +
          (tab === "build" ? "build-layout" : "") +
          (tab === "design" ? " is-design mobile-" + mobileEditor : "")
        }
      >
        <aside className="left-panel" id="studio-left-panel">
          {tab === "design" ? (
            <>
              <div className="conversation-editor">
                <div className="panel-intro">
                  <span className="eyebrow">Make it yours</span>
                  <h2>What would you change?</h2>
                  <p>
                    Describe the detail. See what it means for the whole design.
                  </p>
                </div>
                <form
                  className="prompt-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void propose();
                  }}
                >
                  <label htmlFor="design-prompt" className="sr-only">
                    Describe a design change
                  </label>
                  <textarea
                    id="design-prompt"
                    data-testid="design-prompt"
                    rows={4}
                    placeholder={
                      design.kind === "turntable"
                        ? "Make the platter 240 mm wide and slow it to 3 rpm…"
                        : "Describe a change, with dimensions…"
                    }
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={readOnly}
                  />
                  <div className="prompt-actions">
                    <div className="reference-actions">
                      <VoiceButton
                        onText={(text) =>
                          setPrompt((v) => (v ? v + " " : "") + text)
                        }
                        onError={setError}
                      />
                      <ReferenceInput
                        image={image}
                        onImage={setImage}
                        onError={setError}
                      />
                    </div>
                    <button
                      data-testid="propose-change"
                      className="button primary icon-only"
                      aria-label="Preview proposed change"
                      disabled={readOnly || promptBusy || !prompt.trim()}
                    >
                      {promptBusy ? (
                        <Loader2 className="spin" size={17} />
                      ) : (
                        <ChevronRight size={18} />
                      )}
                    </button>
                  </div>
                </form>
                {promptBusy && (
                  <div className="thinking">
                    <Loader2 size={16} className="spin" />
                    <span>Working through the design…</span>
                  </div>
                )}
                {proposal && (
                  <section className="proposal" aria-label="Proposed change">
                    <div className="panel-heading">
                      <h3>Review the change</h3>
                      <button
                        className="button icon-only"
                        aria-label="Dismiss proposal"
                        onClick={() => setProposal(null)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <p>{proposal.explanation}</p>
                    {proposal.questions?.map((q) => (
                      <p className="measurement-question" key={q}>
                        <Ruler size={16} />
                        {q}
                      </p>
                    ))}
                    <dl>
                      {Object.entries(proposal.command.changes || {}).map(
                        ([k, v]) => (
                          <div key={k}>
                            <dt>
                              {product?.parameters.find((p) => p.key === k)
                                ?.label || k}
                            </dt>
                            <dd>
                              <del>{design.params[k]}</del>
                              <ChevronRight size={12} />
                              <strong>{v}</strong>
                              <small>
                                {
                                  product?.parameters.find((p) => p.key === k)
                                    ?.unit
                                }
                              </small>
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                    {proposal.command.customParts && (
                      <p>
                        {proposal.command.customParts.length} parts in the
                        proposed design.
                      </p>
                    )}
                    <button
                      data-testid="apply-proposal"
                      className="button primary wide"
                      onClick={() => void run(proposal.command)}
                      disabled={
                        busy ||
                        readOnly ||
                        (!Object.keys(proposal.command.changes || {}).length &&
                          !proposal.command.customParts)
                      }
                    >
                      <Check size={16} /> Apply change
                    </button>
                  </section>
                )}
                {notice && (
                  <p className="success inline-notice" role="status">
                    <CheckCircle2 size={17} />
                    {notice}
                  </p>
                )}
                <button className="fit-button" onClick={() => setFit(!fit)}>
                  <Ruler size={19} />
                  <div>
                    <strong>Fit something you own</strong>
                    <span>Start with a measurement</span>
                  </div>
                  <ChevronDown size={15} />
                </button>
                {fit && (
                  <div className="fit-panel">
                    <p>
                      Measure the space or object. Your photo helps explain the
                      shape.
                    </p>
                    <div className="two-inputs">
                      <label>
                        Width (mm)
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          value={fitWidth}
                          onChange={(e) => setFitWidth(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Height (mm)
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          value={fitHeight}
                          onChange={(e) => setFitHeight(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <button
                      className="button small wide"
                      onClick={() =>
                        setPrompt(
                          "Help adapt this " +
                            design.name +
                            " to fit an object " +
                            fitWidth +
                            " mm wide and " +
                            fitHeight +
                            " mm high. Ask for any other measurement you need.",
                        )
                      }
                    >
                      Use these measurements
                    </button>
                  </div>
                )}
              </div>
              <details className="history-panel">
                <summary>
                  <RotateCcw size={15} /> Design history{" "}
                  <span>{history.length}</span>
                </summary>
                {myHistory.length === 0 ? (
                  <p className="subtle">Your changes will appear here.</p>
                ) : (
                  myHistory.slice(0, 10).map((h) => (
                    <article key={h.id}>
                      <strong>{h.summary}</strong>
                      <span>
                        {h.actor} · Revision {h.revision}
                      </span>
                    </article>
                  ))
                )}
                <button
                  className="button small"
                  disabled={readOnly || busy || pending || !history.length}
                  onClick={() => void undo()}
                >
                  <Undo2 size={15} /> Undo my last change
                </button>
              </details>
            </>
          ) : tab === "assemble" ? (
            <>
              <div className="panel-intro">
                <span className="eyebrow">One part at a time</span>
                <h2>Put it together.</h2>
                <p>Explore the assembly before you head to the workbench.</p>
              </div>
              <ol className="assembly-list">
                {derived.steps.map((s, i) => (
                  <li key={s.id}>
                    <button
                      className={step === i ? "active" : ""}
                      onClick={() => changeStep(i)}
                    >
                      <span
                        className={
                          "step-number " +
                          (completed.includes(s.id) ? "complete" : "")
                        }
                      >
                        {completed.includes(s.id) ? <Check size={14} /> : i + 1}
                      </span>
                      <strong>{s.title}</strong>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="assembly-progress">
                <span>
                  {completed.length} of {derived.steps.length} steps reviewed
                </span>
                <progress value={completed.length} max={derived.steps.length} />
              </div>
            </>
          ) : (
            <>
              <div className="panel-intro">
                <span className="eyebrow">From screen to workbench</span>
                <h2>Ready for the next step.</h2>
                <p>
                  Review your parts and prepare a consistent package for making
                  or requesting a quote.
                </p>
              </div>
              <div className="build-summary">
                <FileText size={30} />
                <strong>{design.name}</strong>
                <span className="mono">Revision {design.revision}</span>
                <p>
                  {derived.parts.filter((p) => p.role !== "reference").length}{" "}
                  components
                  <br />
                  {derived.steps.length} assembly steps
                </p>
              </div>
              <p className="subtle">
                The package keeps every file tied to this design revision.
              </p>
            </>
          )}
        </aside>
        <section className="scene-panel" aria-label="3D design workspace">
          <div className="scene-heading">
            <span className="eyebrow">
              {tab === "assemble"
                ? "Assembly view"
                : tab === "build"
                  ? "Your accepted design"
                  : "Working model"}
            </span>
            <div className="scene-heading-actions">
              {others.length > 0 && (
                <label className="follow-control">
                  <Users size={15} />
                  <select
                    aria-label="Follow a collaborator camera"
                    value={follow}
                    onChange={(e) => setFollow(e.target.value)}
                  >
                    <option value="">My view</option>
                    {others.map((p) => (
                      <option key={p.clientId} value={p.clientId}>
                        Follow {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="mono">
                {derived.parts.filter((p) => p.role !== "reference").length}{" "}
                parts
              </span>
            </div>
          </div>
          <ModelCanvas
            parts={visibleParts}
            activePartIds={
              tab === "assemble" ? currentStep?.partIds : undefined
            }
            playing={playing}
            speed={speed}
            exploded={exploded}
            dimensions={dimensions}
            selected={selected}
            onSelect={setSelected}
            reset={reset}
            camera={following?.camera}
            onCamera={cameraChanged}
          />
          {chosen && (
            <div className="part-selection">
              <span
                className="part-color"
                style={{ background: chosen.color }}
              />
              <div>
                <strong>{chosen.name}</strong>
                <span>
                  {chosen.material} ·{" "}
                  {chosen.size.map((v) => Math.round(v)).join(" × ")} mm
                </span>
              </div>
              <button
                className="button icon-only"
                aria-label="Clear selected part"
                onClick={() => setSelected("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="viewer-toolbar studio-viewer-toolbar">
            <button
              className={"button " + (playing ? "primary" : "")}
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? "Pause mechanism" : "Run mechanism"}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
              <span>{playing ? "Pause" : "Try it"}</span>
            </button>
            <button
              className={"button icon-only " + (exploded ? "selected" : "")}
              onClick={() => setExploded(!exploded)}
              aria-label="Toggle exploded assembly"
              title="Exploded assembly"
            >
              <Layers3 size={18} />
            </button>
            <button
              className={"button icon-only " + (dimensions ? "selected" : "")}
              onClick={() => setDimensions(!dimensions)}
              aria-label="Toggle dimensions"
              title="Dimensions"
            >
              <Ruler size={18} />
            </button>
            <button
              className="button icon-only"
              onClick={() => setReset((v) => v + 1)}
              aria-label="Reset camera"
              title="Reset camera"
            >
              <RotateCcw size={17} />
            </button>
            <label className="speed-control">
              <span>Speed</span>
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
          </div>
          <p className="scene-hint">
            Drag to rotate · Scroll to zoom · Select a part to inspect
          </p>
        </section>
        {tab === "design" && (
          <div
            className="mobile-editor-switch"
            role="group"
            aria-label="Editing tools"
          >
            <button
              className={mobileEditor === "dimensions" ? "active" : ""}
              onClick={() => setMobileEditor("dimensions")}
            >
              <Settings2 size={16} /> Dimensions
            </button>
            <button
              className={mobileEditor === "prompt" ? "active" : ""}
              onClick={() => setMobileEditor("prompt")}
            >
              <MessageSquare size={16} /> Describe a change
            </button>
          </div>
        )}
        <aside className="right-panel" id="studio-right-panel">
          {tab === "design" ? (
            <>
              <div className="panel-heading">
                <h2>Design details</h2>
                <Settings2 size={17} />
              </div>
              <div className="parameter-list">
                {product?.parameters.map((spec) => (
                  <label className="parameter" key={spec.key}>
                    <span>
                      {spec.label}
                      <small>{spec.unit}</small>
                    </span>
                    <div className="parameter-input">
                      <input
                        type="range"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        aria-label={spec.label + " slider"}
                        value={draft[spec.key] ?? design.params[spec.key]}
                        disabled={readOnly || busy}
                        onChange={(e) => edit(spec.key, Number(e.target.value))}
                      />
                      <input
                        type="number"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        aria-label={spec.label}
                        data-testid={"param-" + spec.key}
                        value={draft[spec.key] ?? design.params[spec.key]}
                        disabled={readOnly || busy}
                        onChange={(e) => edit(spec.key, Number(e.target.value))}
                      />
                    </div>
                    <small>{spec.description}</small>
                  </label>
                ))}
              </div>
              {pending && (
                <div className="pending-changes">
                  <button
                    data-testid="apply-dimensions"
                    className="button primary wide"
                    disabled={busy || readOnly}
                    onClick={() => void applyDraft()}
                  >
                    {busy ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Check size={16} />
                    )}{" "}
                    Apply dimensions
                  </button>
                  <button
                    className="button quiet small wide"
                    onClick={() => {
                      setDraft({});
                      setBase(null);
                    }}
                  >
                    Discard changes
                  </button>
                </div>
              )}
              {design.kind === "custom" && (
                <button
                  className="button wide"
                  disabled={readOnly}
                  onClick={() => setNewPart(true)}
                >
                  <Plus size={16} /> Add a component
                </button>
              )}
              <section className="consequences">
                <h3>What follows</h3>
                <div className="metric-list">
                  {derived.metrics.map((m) => (
                    <div key={m.label}>
                      <span>{m.label}</span>
                      <strong className="mono">
                        {typeof m.value === "number"
                          ? Math.round(m.value * 100) / 100
                          : m.value}
                        <small>{m.unit ? " " + m.unit : ""}</small>
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
              <details className="parts-disclosure">
                <summary>
                  <Box size={16} /> Components{" "}
                  <span>
                    {derived.parts.filter((p) => p.role !== "reference").length}
                  </span>
                </summary>
                {derived.parts.map((p) => (
                  <button
                    key={p.id}
                    className={
                      "component-row " + (selected === p.id ? "selected" : "")
                    }
                    onClick={() => setSelected(p.id)}
                  >
                    <span
                      className="part-color"
                      style={{ background: p.color }}
                    />
                    <strong>{p.name}</strong>
                    <small>{p.process}</small>
                  </button>
                ))}
              </details>
              {derived.warnings.length > 0 && (
                <details className="engineering-notes">
                  <summary>Before you build</summary>
                  {derived.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </details>
              )}
            </>
          ) : tab === "assemble" && currentStep ? (
            <>
              <span className="eyebrow">
                Step {step + 1} of {derived.steps.length}
              </span>
              <h2 className="assembly-title">{currentStep.title}</h2>
              <p className="assembly-instruction">{currentStep.instruction}</p>
              <div className="step-parts">
                <h3>Parts for this step</h3>
                {currentStep.partIds.map((partId) => {
                  const p = derived.parts.find((p) => p.id === partId);
                  return p ? (
                    <button
                      className={
                        "component-row " + (selected === p.id ? "selected" : "")
                      }
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                    >
                      <span
                        className="part-color"
                        style={{ background: p.color }}
                      />
                      {p.name}
                    </button>
                  ) : null;
                })}
              </div>
              <div className="assembly-check">
                <h3>Check before moving on</h3>
                <p>{currentStep.check}</p>
                <div className="orientation-controls">
                  <button
                    className="button small"
                    disabled={!selected}
                    onClick={() => {
                      setPlaying(false);
                      setPractice((n) => (n + 1) % 4);
                      setCheck(null);
                    }}
                  >
                    <RotateCcw size={14} /> Turn part 90°
                  </button>
                  <button
                    className="button small"
                    disabled={!practice}
                    onClick={() => {
                      setPractice(0);
                      setCheck(null);
                    }}
                  >
                    Reset orientation
                  </button>
                </div>
                <button
                  className="button wide"
                  disabled={!selected}
                  onClick={() => {
                    setPlaying(false);
                    setCheck(
                      currentStep.partIds.includes(selected)
                        ? practice
                          ? {
                              ok: false,
                              text: "The selected part is turned away from its assembly orientation. Reset or rotate it back, then check again.",
                            }
                          : {
                              ok: true,
                              text: "That is a part used in this step, and its virtual orientation matches the assembly. Review the physical connections before building.",
                            }
                        : {
                            ok: false,
                            text:
                              "This step uses " +
                              currentStep.partIds
                                .map(
                                  (id) =>
                                    derived.parts.find((p) => p.id === id)
                                      ?.name || id,
                                )
                                .join(" and ") +
                              ". Select one of those parts in the model.",
                          },
                    );
                  }}
                >
                  <Eye size={16} /> Check selected part
                </button>
                {check && (
                  <p className={check.ok ? "success" : "error"} role="status">
                    {check.text}
                  </p>
                )}
              </div>
              <button
                className="button primary wide"
                onClick={() => {
                  setCompleted((c) =>
                    Array.from(new Set([...c, currentStep.id])),
                  );
                  if (step < derived.steps.length - 1) changeStep(step + 1);
                }}
              >
                <Check size={16} />{" "}
                {completed.includes(currentStep.id)
                  ? "Step reviewed"
                  : "Mark step reviewed"}
              </button>
              <p className="subtle">
                Orientation practice leaves your design unchanged. Verify
                physical fit and connections at the bench.
              </p>
            </>
          ) : (
            <BuildPanel
              snapshot={snapshot}
              job={job}
              busy={busy}
              token={token}
              readOnly={!!readOnly}
              onBuild={() => void build()}
            />
          )}
        </aside>
      </main>
      {notes && (
        <div className="notes-drawer" id="shared-notes-drawer">
          <div className="panel-heading">
            <h2>Work together</h2>
            <button
              className="button icon-only"
              aria-label="Close shared notes"
              onClick={() => setNotes(false)}
            >
              <X size={17} />
            </button>
          </div>
          <label>
            Your name
            <input
              value={actor}
              onChange={(e) => {
                changeActor(e.target.value);
                setActor(e.target.value);
              }}
              maxLength={30}
            />
          </label>
          <SharedNotes
            id={id}
            token={token}
            actor={actor}
            readOnly={!!readOnly}
            onReference={(value) => {
              setImage(value);
              setNotes(false);
              setTab("design");
              setMobileEditor("prompt");
            }}
          />
        </div>
      )}
      {share && (
        <ShareModal
          id={id}
          token={token}
          readOnly={!!readOnly}
          actor={actor}
          onActor={(name) => {
            changeActor(name);
            setActor(name);
          }}
          onClose={() => setShare(false)}
        />
      )}
      {newPart && (
        <NewPartModal
          onClose={() => setNewPart(false)}
          onAdd={async (part) => {
            const ok = await run({
              id: uid(),
              baseRevision: design.revision,
              actor,
              changes: {},
              readSet: { ...design.params },
              customParts: [...(design.customParts || []), part],
              summary: "Added " + part.name,
            });
            if (ok) setNewPart(false);
          }}
        />
      )}
    </div>
  );
}
function ShareModal({
  id,
  token,
  readOnly,
  actor,
  onActor,
  onClose,
}: {
  id: string;
  token: string;
  readOnly: boolean;
  actor: string;
  onActor: (n: string) => void;
  onClose: () => void;
}) {
  useDialog(true, onClose);
  const saved = recent().find((x) => x.id === id);
  const [role, setRole] = useState<"edit" | "view">(readOnly ? "view" : "edit"),
    [copied, setCopied] = useState(false);
  const selectedToken =
    role === "view" ? (readOnly ? token : saved?.viewerToken || "") : token;
  const url = location.origin + pathFor(id, selectedToken);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-heading">
          <h2 id="share-title">Make it together.</h2>
          <button
            className="button icon-only"
            aria-label="Close sharing"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Invite someone into this design. Changes appear in both workspaces.
        </p>
        <label>
          Your name
          <input
            value={actor}
            onChange={(e) => onActor(e.target.value)}
            maxLength={30}
          />
        </label>
        <div className="share-roles">
          {!readOnly && (
            <button
              className={"button " + (role === "edit" ? "selected" : "")}
              onClick={() => {
                setRole("edit");
                setCopied(false);
              }}
            >
              <Settings2 size={16} /> Can edit
            </button>
          )}
          <button
            className={"button " + (role === "view" ? "selected" : "")}
            onClick={() => {
              setRole("view");
              setCopied(false);
            }}
          >
            <Eye size={16} /> Can view
          </button>
        </div>
        {selectedToken ? (
          <>
            <label>
              Invitation link
              <input readOnly value={url} onFocus={(e) => e.target.select()} />
            </label>
            <button
              className="button primary wide"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
              {copied ? "Link copied" : "Copy invitation"}
            </button>
          </>
        ) : (
          <p className="subtle">
            The view-only link is available in the browser that created this
            design.
          </p>
        )}
        <p className="subtle">
          Anyone with this link has the selected access. Keep editing links with
          your collaborators.
        </p>
      </section>
    </div>
  );
}
function BuildPanel({
  snapshot,
  job,
  busy,
  token,
  readOnly,
  onBuild,
}: {
  snapshot: Snapshot;
  job: BuildJob | null;
  busy: boolean;
  token: string;
  readOnly: boolean;
  onBuild: () => void;
}) {
  const { design, derived } = snapshot;
  const working = job && ["queued", "running"].includes(job.status);
  const url = job?.downloadUrl || "/api/builds/" + job?.id + "/download";
  return (
    <>
      <div className="panel-heading">
        <h2>Build package</h2>
        <Download size={18} />
      </div>
      <ul className="package-list">
        {[
          "Parametric source + design",
          "STEP and STL geometry",
          "Dimensioned drawings",
          "Parts list and materials",
          "Assembly and wiring notes",
          "Fabrication quote request",
        ].map((s) => (
          <li key={s}>
            <Check size={15} />
            {s}
          </li>
        ))}
      </ul>
      <button
        data-testid="generate-build"
        className="button primary wide"
        onClick={onBuild}
        disabled={busy || !!working || readOnly}
      >
        {working || busy ? (
          <Loader2 className="spin" size={17} />
        ) : (
          <PackageOpen size={17} />
        )}{" "}
        {working ? "Preparing files…" : "Prepare build package"}
      </button>
      {job?.status === "ready" && (
        <div className="build-ready">
          <CheckCircle2 size={23} />
          <h3>Your files are ready.</h3>
          <p>
            Revision {job.revision}
            {job.revision !== design.revision
              ? " · An earlier version of this design"
              : ""}
          </p>
          <a
            className="button primary wide"
            href={
              url +
              (url.includes("?") ? "&" : "?") +
              "token=" +
              encodeURIComponent(token)
            }
            download
          >
            <Download size={16} /> Download package
          </a>
        </div>
      )}
      {job?.status === "failed" && (
        <div className="error" role="alert">
          <p>
            {job.error || "The build could not finish. Your design is saved."}
          </p>
          <button className="button small" onClick={onBuild}>
            Try again
          </button>
        </div>
      )}
      <details className="parts-disclosure" open>
        <summary>
          <Box size={16} /> Parts list <span>{derived.bom.length}</span>
        </summary>
        <div className="bom-list">
          {derived.bom.map((b) => (
            <div key={b.id} className="bom-row">
              <div>
                <strong>{b.name}</strong>
                <span>{b.specification}</span>
                <small>
                  {b.material} · {b.process}
                </small>
              </div>
              <span className="mono">×{b.quantity}</span>
              {b.sourceUrl && (
                <a
                  className="button small"
                  href={b.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Find supplier
                </a>
              )}
            </div>
          ))}
        </div>
      </details>
      <details className="engineering-notes">
        <summary>Review before fabrication</summary>
        {derived.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p>
          Review tolerances, materials and machine setup with your fabricator.
          This package does not contain machine-specific toolpaths.
        </p>
      </details>
    </>
  );
}
function NewPartModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (part: Part) => Promise<void>;
}) {
  useDialog(true, onClose);
  const [name, setName] = useState("New component"),
    [shape, setShape] = useState<"box" | "cylinder" | "tube">("box"),
    [width, setWidth] = useState(40),
    [height, setHeight] = useState(20),
    [depth, setDepth] = useState(40),
    [x, setX] = useState(0),
    [y, setY] = useState(80),
    [z, setZ] = useState(0),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="part-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onAdd({
            id: uid(),
            name,
            shape,
            size: [width, height, shape === "box" ? depth : width],
            holeDiameter: shape === "tube" ? width * 0.7 : undefined,
            position: [x, y, z],
            color: colors.border,
            material: "PLA",
            process: "print",
          });
          setBusy(false);
        }}
      >
        <div className="panel-heading">
          <h2 id="part-title">Add a component</h2>
          <button
            type="button"
            className="button icon-only"
            aria-label="Close component"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Shape
          <select
            value={shape}
            onChange={(e) => setShape(e.target.value as typeof shape)}
          >
            <option value="box">Box</option>
            <option value="cylinder">Cylinder</option>
            <option value="tube">Tube</option>
          </select>
        </label>
        <div className="three-inputs">
          {[
            ["Width", width, setWidth],
            ["Height", height, setHeight],
            ["Depth", depth, setDepth],
          ].map(([s, v, fn]) => (
            <label key={String(s)}>
              {String(s)} mm
              <input
                type="number"
                min={1}
                max={1000}
                value={v as number}
                onChange={(e) =>
                  (fn as (v: number) => void)(Number(e.target.value))
                }
              />
            </label>
          ))}
        </div>
        <div className="three-inputs">
          {[
            ["X", x, setX],
            ["Y", y, setY],
            ["Z", z, setZ],
          ].map(([s, v, fn]) => (
            <label key={String(s)}>
              {String(s)} mm
              <input
                type="number"
                min={-1000}
                max={1000}
                value={v as number}
                onChange={(e) =>
                  (fn as (v: number) => void)(Number(e.target.value))
                }
              />
            </label>
          ))}
        </div>
        <button
          className="button primary wide"
          disabled={busy || Math.min(width, height, depth) <= 0}
        >
          <Plus size={17} /> Add component
        </button>
      </form>
    </div>
  );
}
