import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
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
  Smartphone,
  Undo2,
  Users,
  X,
  Box,
  AlertCircle,
  PackageOpen,
  RefreshCw,
  FlaskConical,
  FileDown,
} from "lucide-react";
import type {
  Access,
  BuildJob,
  Command,
  Design,
  Part,
  Presence,
  Proposal,
  ProposalTarget,
  Snapshot,
  Vec3,
} from "./shared/types";
import { CATALOG, productForDesign } from "./shared/catalog";
import { deriveDesign, readSetFor } from "./shared/engine";
import {
  api,
  ApiError,
  uid,
  tokenFromUrl,
  recent,
  remember,
  rememberInvitation,
  getActor,
  setActor,
  pathFor,
} from "./lib/api";
import ModelCanvas from "./components/ModelCanvas";
import ContextualGuide from "./components/ContextualGuide";
import { assertCurrentSelection, createSelection, resolveSelectionSurface, type SelectionRef } from "./shared/selection";
import { cycleSurface, freezeTarget, targetLabel, withoutSurface } from "./lib/pointing";
import SharedNotes from "./components/SharedNotes";
import ReferenceInput, { VoiceButton } from "./components/ReferenceInput";
import CompanionCursor, { AgentDock, type AgentPointer } from "./components/CompanionCursor";
import RoomSheet from "./components/RoomSheet";
import ProposalCheck, { type ProposalCheckHandle } from "./components/ProposalCheck";
import { replyLines, useVoiceAgent } from "./lib/voiceAgent";
import { askWhichPart, clarifyCandidates, isClarification, resolveAnswer } from "./lib/clarify";
import type { PartTargetRequest, ScreenTarget } from "./lib/projection";
import { Brand, type Navigate } from "./App";
import { colors } from "./lib/tokens";
import { useDialog } from "./lib/useDialog";
import { FIRST_REQUEST_KEY } from "./lib/heroProduct";
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
  const [selection, setSelection] = useState<SelectionRef | null>(null);
  const [pendingCircleSelection, setPendingCircleSelection] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<SelectionRef | null>(null);
  const hoverPicker = useRef<(() => SelectionRef | null) | null>(null);
  const utteranceRef = useRef<SelectionRef | null>(null);
  const [requestSelection, setRequestSelection] = useState<SelectionRef | null | undefined>(undefined);
  // The target a pending proposal was requested for, shown as "Applied to" during review.
  const [proposalBinding, setProposalBinding] = useState<SelectionRef | null>(null);
  const [unboundVoice, setUnboundVoice] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [editorMode, setEditorMode] = useState<"prompt" | "selection">("prompt");
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
  const [rememberFailed, setRememberFailed] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({}),
    [base, setBase] = useState<Design | null>(null),
    [share, setShare] = useState(false),
    [notes, setNotes] = useState(false),
    [fit, setFit] = useState(false),
    [fitWidth, setFitWidth] = useState("100"),
    [fitHeight, setFitHeight] = useState("80");
  const [practice, setPractice] = useState(0),
    [mobileEditor, setMobileEditor] = useState<"canvas" | "dimensions" | "prompt">(
      "canvas",
    );
  const [leftPanelOpen, setLeftPanelOpen] = useState(false),
    [rightPanelOpen, setRightPanelOpen] = useState(false),
    [more, setMore] = useState(false);
  // The More panel closes on any press outside it.
  useEffect(() => {
    if (!more) return;
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement | null)?.closest(".studio-more")) setMore(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [more]);
  // A request typed or spoken on the home page arrives here as the first request.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FIRST_REQUEST_KEY);
      if (!raw) return;
      const first = JSON.parse(raw) as { id: string; text: string; image?: string | null };
      if (first.id !== id) return;
      sessionStorage.removeItem(FIRST_REQUEST_KEY);
      setPrompt(first.text);
      if (first.image) setImage(first.image);
      setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt");
    } catch { /* Storage can be unavailable; the studio still opens normally. */ }
  }, [id]);
  const previousSelection = useRef<SelectionRef | null>(null);
  useEffect(() => {
    const previous = previousSelection.current; previousSelection.current = selection;
    if (tab === "design" && selection?.partIds.length) {
      // Pointing at another surface of the same part keeps the current editor mode.
      const sameParts = !!previous && previous !== selection && previous.designId === selection.designId && previous.partIds.join() === selection.partIds.join();
      setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt");
      if (!sameParts) setEditorMode("selection");
    }
  }, [selection, tab]);
  const [step, setStep] = useState(0),
    [completed, setCompleted] = useState<string[]>([]),
    [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null),
    [follow, setFollow] = useState(""),
    [newPart, setNewPart] = useState(false);
  const [buildRestoring, setBuildRestoring] = useState(false),
    [buildStatusError, setBuildStatusError] = useState(""),
    [buildRefresh, setBuildRefresh] = useState(0);
  const buildReadVersion = useRef(0);
  const requestedBuild = useRef<string | undefined>(undefined);
  const ws = useRef<WebSocket | null>(null);
  const clientId = useRef(uid());
  const mounted = useRef(true);
  const product = snapshot ? productForDesign(snapshot.design) : undefined;
  const readOnly = snapshot?.role === "viewer";
  const validFitMeasurement = (value: string) =>
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= 2000;
  const fitWidthValid = validFitMeasurement(fitWidth);
  const fitHeightValid = validFitMeasurement(fitHeight);
  const fitMeasurementsValid = fitWidthValid && fitHeightValid;
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
      const incoming = await api<Snapshot>("/designs/" + id, token);
      acceptSnapshot(incoming);
      setRememberFailed(!rememberInvitation(incoming, token));
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
      if (stopped) return;
      setConnected(false);
      const connection = new WebSocket(
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
      socket = connection;
      ws.current = connection;
      const isCurrent = () => !stopped && ws.current === connection;
      connection.onopen = () => {
        if (isCurrent()) setConnected(true);
      };
      connection.onmessage = (e) => {
        if (!isCurrent()) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === "snapshot") acceptSnapshot(m.snapshot);
          if (m.type === "presence") setPeers(m.peers);
          if (m.type === "error") setError(m.message);
        } catch {}
      };
      connection.onclose = () => {
        if (!isCurrent()) return;
        setConnected(false);
        timer = setTimeout(connect, 2500);
      };
      connection.onerror = () => {
        if (isCurrent()) setConnected(false);
      };
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
    if (tab !== "build" || !token) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setBuildRestoring(true);
    let pollJobId = requestedBuild.current;
    requestedBuild.current = undefined;
    const refresh = async () => {
      const version = buildReadVersion.current;
      let retry = false;
      try {
        const latest = await api<BuildJob | null>(
          pollJobId ? "/builds/" + pollJobId : "/designs/" + id + "/builds/latest", token,
        );
        if (stopped || version !== buildReadVersion.current) return;
        pollJobId = latest?.id;
        setJob(latest);
        setBuildStatusError("");
        retry = !!latest && ["queued", "running"].includes(latest.status);
      } catch (e) {
        if (stopped || version !== buildReadVersion.current) return;
        retry = !(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429);
        setBuildStatusError(retry
          ? "Could not check your package. Trying again…"
          : "Package access could not be verified. Reopen the design with a valid invitation.");
      } finally {
        if (!stopped) {
          setBuildRestoring(false);
          if (retry) timer = setTimeout(refresh, 1500);
        }
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, token, tab, buildRefresh]);
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
  async function propose(text = prompt, target = requestSelection === undefined ? selection : requestSelection, wholeDesign = false) {
    if (!snapshot || !text.trim() || readOnly || promptBusy) return;
    if (unboundVoice && target === null && !wholeDesign) { setError("Hover over a part and speak again, or edit the typed request before sending it."); return; }
    setPromptBusy(true);
    setError("");
    setNotice("");
    try {
      const p = await api<Proposal>("/designs/" + id + "/propose", token, {
        prompt: text,
        actor,
        ...(target ? { selection: target } : {}),
        ...(image ? { image } : {}),
      });
      setProposalBinding(target ?? null);
      setProposal(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPromptBusy(false);
    }
  }
  function speechStarted() {
    // Freeze the exact pointed surface at speech onset; later movement cannot retarget it.
    const target = freezeTarget(hoverPicker.current?.() || null);
    utteranceRef.current = target;
    setVoiceTarget(target);
    const name = target && snapshot ? targetLabel(snapshot, target) : "";
    setVoiceMessage(name ? `Listening about ${name}.` : "No part under the pointer. Your words will be kept as a draft.");
  }
  function spokenRequest(text: string, wholeDesign = false) {
    const target = utteranceRef.current;
    utteranceRef.current = null;
    setPrompt(text); setRequestSelection(target); setUnboundVoice(!target);
    setEditorMode("prompt"); setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt");
    if (!target || !snapshot) {
      const ask = snapshot && !proposal && !readOnly && tab === "design" ? askWhichPart(snapshot, text, actor, uid()) : null;
      if (ask) { setProposalBinding(null); setProposal(ask); return; }
      // Hold-to-talk with nothing pointed at and no "this" or "these": a request about the whole design.
      // The click-to-talk button keeps such words as a draft.
      if (wholeDesign && snapshot && !proposal && !readOnly && tab === "design" && !/\b(this|that|these|those|here|there|it)\b/i.test(text)) {
        setUnboundVoice(false); setRequestSelection(null); setVoiceMessage("");
        void propose(text, null, true); return;
      }
      setVoiceMessage("No part was targeted. Hover over a part and try again, or edit the typed request."); return;
    }
    try { assertCurrentSelection(snapshot, target); }
    catch (error) { setError((error as Error).message); return; }
    if (proposal || readOnly || tab !== "design") { setError("Return to the current design before speaking another request."); return; }
    setVoiceMessage("");
    void propose(text, target);
  }
  useEffect(() => {
    // Do not rebind an utterance after a remote revision; server validation also rejects it.
    setVoiceTarget(null);
    // A pinned surface belongs to the geometry it was pointed at; never carry it to a new revision.
    setSelection(current => current?.surface && current.revision !== snapshot?.design.revision ? withoutSurface(current) : current);
    setRequestSelection(current => current?.surface && current.revision !== snapshot?.design.revision ? withoutSurface(current) : current);
  }, [snapshot?.design.id, snapshot?.design.revision]);
  // Voice companion: hold-to-talk, spoken replies and the assistant circle.
  const projector = useRef<((target: PartTargetRequest) => ScreenTarget | null) | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [room, setRoom] = useState(false);
  const checkRef = useRef<ProposalCheckHandle>(null);
  function voiceListening(active: boolean) {
    setVoiceOn(active);
    if (!active) { utteranceRef.current = null; setVoiceTarget(null); setVoiceMessage(message => /^(Listening about|Hover over a part, then|No part under the pointer)/.test(message) ? "" : message); }
    else { setVoiceMessage("Hover over a part, then speak your request."); setPlaying(false); }
  }
  function companionSpeechStarted() {
    speechStarted();
    // Holding the mic leaves the model, so a pinned or selected part is the target.
    const pinned = requestSelection === undefined ? selection : requestSelection;
    if (utteranceRef.current || !pinned || !snapshot) return;
    const target = freezeTarget(pinned);
    utteranceRef.current = target; setVoiceTarget(target);
    setVoiceMessage(`Listening about ${targetLabel(snapshot, target)}.`);
  }
  // A question asked before any assistant call stays open for a spoken answer.
  const clarifying = isClarification(proposal);
  const candidates = useMemo(() => clarifying && snapshot ? clarifyCandidates(snapshot, proposal!, prompt) : [], [clarifying, proposal, snapshot, prompt]);
  function answerClarification(text: string) {
    const pointed = utteranceRef.current;
    utteranceRef.current = null;
    if (!snapshot || !proposal) return;
    if (!candidates.length) {
      // An open question without listed choices: the answer joins the request and is proposed again.
      if (/\b(never ?mind|cancel|forget it)\b/i.test(text)) { setProposal(null); return; }
      const combined = `${prompt.trim()}. ${text}`.slice(0, 2000), target = pointed ?? proposalBinding;
      setProposal(null); setPrompt(combined); setRequestSelection(target ?? undefined);
      void propose(combined, target);
      return;
    }
    const answer = resolveAnswer(snapshot, text, candidates, pointed, c => projector.current?.({ partIds: [c.partId], featureId: c.featureId }) ?? null);
    if (answer.kind === "cancel") { setProposal(null); return; }
    if (answer.kind === "unclear") { setProposal({ ...proposal, command: { ...proposal.command, id: uid() }, explanation: `I could not tell which one from “${text}”.`, questions: [answer.message] }); return; }
    setProposal(null); setRequestSelection(answer.candidate.target); setUnboundVoice(false); setVoiceMessage("");
    void propose(prompt, answer.candidate.target);
  }
  const voice = useVoiceAgent({
    disabled: !snapshot || readOnly || busy || promptBusy || (!!proposal && !clarifying) || pendingCircleSelection || tab !== "design",
    spaceToTalk: !!snapshot && !readOnly && tab === "design",
    onSpeechStart: companionSpeechStarted, onText: text => clarifying ? answerClarification(text) : spokenRequest(text, true), onError: setError, onListeningChange: voiceListening,
    reply: proposal ? { key: proposal.command.id, lines: [...replyLines(proposal),
      ...(candidates.length && !proposal.questions?.some(q => /say this one/i.test(q)) ? ["Point at one and say this one, or say the left one or the right one."] : [])].slice(0, 4) } : null,
  });
  // Parts a proposal changes, for a whole-design reply that names no target (at most six).
  const changedPartIds = useMemo(() => {
    if (!proposal?.command.customParts || !snapshot) return [];
    const before = new Map((snapshot.design.customParts || []).map(p => [p.id, JSON.stringify(p)]));
    const ids = proposal.command.customParts.filter(p => before.get(p.id) !== JSON.stringify(p)).map(p => p.id);
    return ids.length <= 6 ? ids : [];
  }, [proposal, snapshot?.design.revision]);
  const agentPointer = useMemo<AgentPointer | null>(() => {
    const target: ProposalTarget | undefined = proposal?.target ?? (proposal && changedPartIds.length ? { partIds: changedPartIds, label: `${changedPartIds.length} parts` } : undefined);
    if (!proposal || !target?.partIds.length) return null;
    const targets = candidates.length
      ? candidates.map(c => ({ key: c.key, label: c.label, partIds: [c.partId], featureId: c.featureId, labelled: candidates.length <= 4 }))
      : target.partIds.length > 1 ? target.partIds.map(id => ({ key: id, label: id, partIds: [id], labelled: false }))
      : [{ key: "target", label: target.label, partIds: target.partIds, featureId: target.featureId, labelled: !target.featureId }];
    return { key: proposal.command.id, targets, locate: t => projector.current?.({ partIds: t.partIds, featureId: t.featureId }) ?? null };
  }, [proposal, candidates, changedPartIds]);
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
      const next = await api<BuildJob>("/designs/" + id + "/build", token, {});
      buildReadVersion.current += 1;
      requestedBuild.current = next.id;
      setBuildRefresh((value) => value + 1);
      setBuildStatusError("");
      setJob(next);
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
  function clearPointing() {
    if (requestSelection) setRequestSelection(withoutSurface(requestSelection));
    else if (selection?.surface) setSelection(withoutSurface(selection));
    requestAnimationFrame(() => document.getElementById("design-prompt")?.focus());
  }
  function selectParts(next: SelectionRef | null) {
    setSelected(next?.partIds[0] || ""); setSelection(next);
    setRequestSelection(undefined); setUnboundVoice(false); setVoiceMessage("");
  }
  function changeStep(next: number) {
    setLeftPanelOpen(false); setRightPanelOpen(true);
    setStep(next);
    selectParts(null);
    setCheck(null);
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
          <button className="button primary" onClick={() => navigate("/browse")}>
            Back to designs
          </button>
        </div>
      </div>
    );
  const { design, derived, history } = snapshot;
  const hasMotion = derived.parts.some(part => part.motion);
  let previewParts = derived.parts;
  if (proposal && proposal.command.baseRevision === design.revision) {
    try { previewParts = deriveDesign({ ...design, params: { ...design.params, ...proposal.command.changes }, ...(proposal.command.customParts ? {customParts:proposal.command.customParts}: {}) }).parts; } catch { /* Acceptance validates again. */ }
  }
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
      : previewParts;
  const currentStep = derived.steps[Math.min(step, derived.steps.length - 1)];
  const chosen = derived.parts.find((p) => p.id === selected);
  const requestTarget = requestSelection === undefined ? selection : requestSelection;
  let pointedFeature = "";
  try { pointedFeature = selection ? resolveSelectionSurface(snapshot, selection)?.feature.label || "" : ""; } catch { pointedFeature = "Surface changed"; }
  const pending = Object.keys(draft).length > 0;
  const firstParam = design.kind === "custom" ? undefined : product?.parameters.find((p) => p.unit === "mm");
  const isDrone = derived.parts.some((p) => p.id === "arm-front-left");
  const dockExample = isDrone ? "Make these arms stiffer" : firstParam ? `Make the ${firstParam.label.toLowerCase()} ${Math.round(Number(design.params[firstParam.key] ?? firstParam.default) + (firstParam.step ?? 10) * 2)} mm` : "Make this hole 8 mm";
  const myHistory = [...history].reverse();
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <Brand onClick={() => navigate("/")} />
        <button
          className="button quiet small back-to-work"
          onClick={() => navigate("/work")}
        >
          <ArrowLeft size={15} /> Your work
        </button>
        <div className="design-title">
          <h1>{design.name}</h1>
          <span className={"connection-dot " + (connected ? "online" : "")} title={connected ? "Saved together" : "Reconnecting…"} />
          <span className="sr-only">
            {connected ? "Saved together" : "Reconnecting…"} / Revision{" "}
            {design.revision}
          </span>
        </div>
      <div
        className="panel-visibility-controls"
        data-task={tab}
        role="group"
        aria-label="Side panels"
      >
        <button
          className="button small"
          aria-label={
            leftPanelOpen ? "Collapse left panel" : "Expand left panel"
          }
          aria-expanded={leftPanelOpen}
          aria-controls="studio-left-panel"
          onClick={() => { setLeftPanelOpen(!leftPanelOpen); if (!leftPanelOpen) setRightPanelOpen(false); }}
        >
          {leftPanelOpen ? (
            <PanelLeftClose size={17} />
          ) : (
            <PanelLeftOpen size={17} />
          )}
          {tab === "design" ? "Describe a change" : tab === "assemble" ? "Assembly steps" : "Package overview"}
        </button>
        <button
          className="button small"
          aria-label={
            rightPanelOpen ? "Collapse right panel" : "Expand right panel"
          }
          aria-expanded={rightPanelOpen}
          aria-controls="studio-right-panel"
          onClick={() => { setRightPanelOpen(!rightPanelOpen); if (!rightPanelOpen) setLeftPanelOpen(false); }}
        >
          {tab === "design" ? "Engineering details" : tab === "assemble" ? "Step details" : "Build files"}
          {rightPanelOpen ? (
            <PanelRightClose size={17} />
          ) : (
            <PanelRightOpen size={17} />
          )}
        </button>
      </div>
        <div className="studio-more">
          <button className={"button small" + (more ? " selected" : "")} aria-label="More" aria-expanded={more} aria-controls="studio-more-panel" onClick={() => setMore(!more)}>
            <Settings2 size={16} /><span>More</span>
          </button>
          <div id="studio-more-panel" className="studio-more-panel" hidden={!more}
            onClick={(event) => { if ((event.target as HTMLElement).closest('[role="tab"], .development-entry')) setMore(false); }}
            onKeyDown={(event) => { if (event.key === "Escape") { setMore(false); (document.querySelector('[aria-controls="studio-more-panel"]') as HTMLButtonElement | null)?.focus(); } }}>
            <p className="studio-more-label">View</p>
        <div className="workspace-tabs" role="tablist" aria-label="Workspace">
          <button
            role="tab"
            aria-selected={tab === "design"}
            className={tab === "design" ? "active" : ""}
            onClick={() => { setTab("design"); setLeftPanelOpen(false); setRightPanelOpen(false); }}
          >
            <Settings2 size={16} /> Design
          </button>
          <button
            role="tab"
            aria-selected={tab === "assemble"}
            className={tab === "assemble" ? "active" : ""}
            onClick={() => {
              setTab("assemble");
              setLeftPanelOpen(false); setRightPanelOpen(true);
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
            onClick={() => { setTab("build"); setLeftPanelOpen(false); setRightPanelOpen(true); }}
          >
            <PackageOpen size={16} /> Build
          </button>
        </div>
        <button className="button small development-entry" aria-label="Engineering & versions" title="Engineering & versions" onClick={() => navigate("/develop/" + id + (selected ? "?part=" + encodeURIComponent(selected) : "") + "#token=" + encodeURIComponent(token))}><FlaskConical size={17}/><span className="development-entry-desktop">Engineering & versions</span><span className="development-entry-phone">Develop</span></button>
          </div>
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
          <div className="header-cluster" role="group" aria-label="Share and view">
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
          <button className="button small room-entry action-room" data-testid="see-in-room" aria-label="See it in your room" aria-haspopup="dialog" aria-expanded={room} onClick={() => setRoom(!room)}>
            <Smartphone size={16} />
            <span>See it in your room</span>
          </button>
          <button className="button small action-share" onClick={() => setShare(true)}>
            <Share2 size={16} />
            <span>Share</span>
          </button>
          </div>
          <button className="button small files-entry" aria-label="Get build files" onClick={() => { setTab("build"); setLeftPanelOpen(false); setRightPanelOpen(true); setMobileEditor("canvas"); }}>
            <FileDown size={16} />
            <span>Get build files</span>
          </button>
        </div>
      </header>
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
                {notice && (
                  <p className="workspace-alert success inline-notice" role="status">
                    <CheckCircle2 size={17} />
                    {notice}
                  </p>
                )}

      {readOnly && (
        <div className="workspace-alert">
          <Eye size={16} />
          <span>You can explore this design. Make a copy to change it.</span>
        </div>
      )}
      {rememberFailed && (
        <div className="workspace-alert" role="status">
          <AlertCircle size={18} />
          <span>
            This browser couldn’t remember this design. Keep your invitation
            link to return to it.
          </span>
        </div>
      )}
      <main
        className={
          "studio-main " +
          (!leftPanelOpen ? " left-panel-collapsed " : "") +
          (!rightPanelOpen ? " right-panel-collapsed " : "") +
          (tab === "build" ? "build-layout" : "") +
          (tab === "design" ? " is-design mobile-" + mobileEditor : "")
        }
      >
        <aside className={"left-panel" + (selection && editorMode === "selection" ? " show-selection" : "")} id="studio-left-panel" onKeyDown={(event) => { if (event.key === "Escape" && !(event.target as HTMLElement).closest('[role="dialog"]')) { setLeftPanelOpen(false); setMobileEditor("canvas"); requestAnimationFrame(() => { const selectors = window.innerWidth <= 820 && tab === "design" ? '.mobile-editor-switch [data-panel="left"]' : '[aria-controls="studio-left-panel"]'; document.querySelector<HTMLButtonElement>(selectors)?.focus(); }); } }}>
          {tab === "design" ? (
            <>
              {selection && !pendingCircleSelection && !proposal && <div className="inspector-tabs" role="group" aria-label="Selected part tools"><button className={"button small " + (editorMode === "selection" ? "primary action-secondary" : "")} onClick={() => setEditorMode("selection")}>Part controls</button><button className={"button small " + (editorMode === "prompt" ? "primary action-secondary" : "")} onClick={() => setEditorMode("prompt")}>Write a request</button></div>}
              <div className="conversation-editor">
                <div className="panel-intro">
                  <h2>What would you change?</h2>

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
                    onChange={(e) => { setPrompt(e.target.value); setUnboundVoice(false); }}
                    disabled={readOnly}
                  />
                  {requestTarget?.surface ? <p className="pointing-chip" data-testid="request-target">
                      <span>Pointing at: {targetLabel(snapshot, requestTarget)}</span>
                      <button type="button" aria-label="Stop pointing at this surface" title="Stop pointing; keep the part" onClick={clearPointing} disabled={readOnly}><X size={14} /></button>
                    </p>
                    : prompt && <p className="subtle" data-testid="request-target">{requestTarget?.partIds.length
                    ? "Request for " + requestTarget.partIds.map(id => derived.parts.find(part => part.id === id)?.name || "a part no longer available").join(", ")
                    : unboundVoice ? "No part targeted. Edit this request or speak again." : "Request for the whole design"}</p>}
                  <div className="prompt-actions">
                    <div className="reference-actions">
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
                    {(proposal.target?.label || proposalBinding) && <p className="proposal-target" data-testid="proposal-target">
                      {Object.keys(proposal.command.changes || {}).length || proposal.command.customParts ? "Applied to" : "Pointing at"}: <strong>{proposal.target?.label || targetLabel(snapshot, proposalBinding)}</strong>
                    </p>}
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
                    {!clarifying && !readOnly && <ProposalCheck ref={checkRef} snapshot={snapshot} proposal={proposal} token={token} actor={actor}
                      partId={proposalBinding?.partIds.find(id => proposal.target?.partIds.includes(id))} disabled={busy} onSay={voice.say} onError={setError} />}
                    <button
                      data-testid="apply-proposal"
                      className="button primary wide"
                      onClick={() => {
                        // A checked proposal is accepted as its version, so the before/after evidence stays with the design.
                        const accepted = checkRef.current?.accept();
                        if (!accepted) { void run(proposal.command); return; }
                        setBusy(true);
                        void accepted.then(ok => { if (ok) { setProposal(null); setNotice("Design updated. Parts and assembly now match."); void reload(); } }).finally(() => setBusy(false));
                      }}
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
                <button className="fit-button" onClick={() => setFit(!fit)}>
                  <Ruler size={19} />
                  <div>
                    <strong>Fit something you own</strong>

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
                          step="any"
                          value={fitWidth}
                          aria-invalid={!fitWidthValid}
                          aria-describedby={
                            !fitMeasurementsValid
                              ? "fit-measurement-error"
                              : undefined
                          }
                          onChange={(e) => setFitWidth(e.target.value)}
                        />
                      </label>
                      <label>
                        Height (mm)
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          step="any"
                          value={fitHeight}
                          aria-invalid={!fitHeightValid}
                          aria-describedby={
                            !fitMeasurementsValid
                              ? "fit-measurement-error"
                              : undefined
                          }
                          onChange={(e) => setFitHeight(e.target.value)}
                        />
                      </label>
                    </div>
                    {!fitMeasurementsValid && (
                      <p id="fit-measurement-error" role="status">
                        Enter a width and height from 1 to 2,000 mm.
                      </p>
                    )}
                    <button
                      className="button small wide"
                      disabled={!fitMeasurementsValid}
                      onClick={() => {
                        if (!fitMeasurementsValid) return;
                        setRequestSelection(null); setUnboundVoice(false);
                        setPrompt(
                          "Help adapt this " +
                            design.name +
                            " to fit an object " +
                            fitWidth +
                            " mm wide and " +
                            fitHeight +
                            " mm high. Ask for any other measurement you need.",
                        );
                      }}
                    >
                      Use these measurements
                    </button>
                  </div>
                )}
              </div>
              {pendingCircleSelection && <p className="subtle">Confirm the circled parts to open their controls.</p>}
              {selection && !pendingCircleSelection && !proposal && editorMode === "selection" && <ContextualGuide snapshot={snapshot} selection={selection} onClearSelection={() => { selectParts(null); requestAnimationFrame(() => document.querySelector<HTMLElement>('.spatial-selection-list > summary')?.focus()); }} onPrompt={(value) => { setRequestSelection(undefined); setUnboundVoice(false); setPrompt(value); setEditorMode("prompt"); }} disabled={readOnly || busy} onPreview={(result) => { setProposalBinding(selection); setProposal({ command:{...result.command,actor}, explanation:result.explanation, source:"local" }); setEditorMode("prompt"); }} />}
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
                        {h.actor} / Revision {h.revision}
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
          <div className="stage-overlay" data-slot="companion-layer" aria-hidden="true" />
          <div className="scene-heading">
            <span className="eyebrow sr-only">
              {tab === "assemble"
                ? "Assembly view"
                : tab === "build"
                  ? "Your accepted design"
                  : proposal ? "Proposed preview" : "Working model"}
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

            </div>
          </div>
          <ModelCanvas
            parts={visibleParts}
            framingKey={`${design.id}:${design.revision}:${exploded}`}
            activePartIds={
              tab === "assemble" ? currentStep?.partIds : undefined
            }
            playing={playing}
            speed={speed}
            exploded={exploded}
            dimensions={dimensions}
            selected={proposal ? undefined : selected}
            hoverEnabled={tab === "design" && (!proposal || clarifying) && !readOnly}
            hoverPicker={hoverPicker}
            onPendingSelectionChange={setPendingCircleSelection}
            voiceTarget={voiceTarget}
            pointedTarget={proposal && !(clarifying && voiceTarget?.surface) ? (proposalBinding?.surface && (proposal.target?.partIds.length ?? 1) <= 1 ? proposalBinding : null) : voiceTarget?.surface ? voiceTarget : requestTarget?.surface ? requestTarget : null}
            onSelect={proposal ? undefined : partId => selectParts(partId ? createSelection(snapshot, [partId], "click") : null)}
            selectionContext={{designId:design.id,revision:design.revision}}
            selectedPartIds={proposal ? undefined : selection?.partIds}
            onSelection={proposal ? undefined : selectParts}
            reset={reset}
            camera={following?.camera}
            onCamera={cameraChanged}
            projector={projector}
            onHoverChange={hover => setHoverLabel(hover?.label ?? null)}
            highlightPartIds={proposal?.target?.partIds ?? changedPartIds}
          />
          {tab === "design" && <CompanionCursor hoverLabel={hoverLabel} phase={voice.phase} transcript={voice.transcript}
            agent={agentPointer} speaking={voice.speaking} />}
          {chosen && !pendingCircleSelection && !proposal && (
            <div className="part-selection">
              <span
                className="part-color"
                style={{ background: chosen.color }}
              />
              <div>
                <strong>{chosen.name}</strong>
                <span>
                  {chosen.material} /{" "}
                  {chosen.size.map((v) => Math.round(v)).join(" × ")} mm
                </span>
                {selection?.partIds.length === 1 && !readOnly && <div className="feature-cycler" role="group" aria-label="Point at a feature of this part">
                  <button type="button" className="button icon-only" aria-label="Previous feature" onClick={() => setSelection(cycleSurface(snapshot, selection, -1))}><ChevronLeft size={14} /></button>
                  <span data-testid="pointed-feature">{pointedFeature || "Whole part"}</span>
                  <button type="button" className="button icon-only" aria-label="Next feature" onClick={() => setSelection(cycleSurface(snapshot, selection, 1))}><ChevronRight size={14} /></button>
                </div>}
              </div>
              <button
                className="button icon-only"
                aria-label="Clear selected part"
                onClick={() => { selectParts(null); }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {tab === "design" && (
            <div className={"assistant-dock" + (proposal ? " has-proposal" : "")} data-slot="agent-dock" role="region" aria-label="Assistant">
              {readOnly ? <p className="assistant-readonly">Make your own copy to ask for changes.</p> : <AgentDock voice={voice} reply={proposal ? replyLines(proposal).join(" ") : undefined}
                disabled={busy || promptBusy || !!proposal || pendingCircleSelection}
                disabledReason={promptBusy ? "Working through the design…" : "Review or dismiss this proposal, then hold to talk again."} className="in-assistant" />}
              <div className="assistant-actions">
                {proposal ? (
                  !leftPanelOpen && <button className="button small primary" onClick={() => { setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt"); }}>Review the change</button>
                ) : (
                  <>
                  {!readOnly && dockExample && (
                      <button className="agent-example" aria-label={"Use example request: " + dockExample} onClick={() => { setPrompt(dockExample); setUnboundVoice(false); setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt"); }}>“{dockExample}”</button>
                    )}
                    {!readOnly && (
                      <button className="button small primary" onClick={() => { setLeftPanelOpen(true); setRightPanelOpen(false); setMobileEditor("prompt"); requestAnimationFrame(() => document.getElementById("design-prompt")?.focus()); }}>Ask the assistant</button>
                    )}
                  </>
                )}
                <div className="voice-control">
                <VoiceButton label="Hands-free" disabled={readOnly || busy || promptBusy || !!proposal || pendingCircleSelection}
                  onText={text => { voice.expectReply(); spokenRequest(text); }} onError={setError} onSpeechStart={speechStarted}
                  onListeningChange={voiceListening} />
                {(voiceOn || voiceMessage || proposal) && <p className="voice-status" role="status" data-testid="voice-status">{proposal && !clarifying ? "Review or dismiss this proposal before using voice." : clarifying && !voiceMessage ? "Hold Space or the mic and answer the question aloud." : voiceMessage}</p>}
                </div>
              </div>
            </div>
          )}
          <div className="viewer-toolbar studio-viewer-toolbar">
            <button
              className={"button " + (playing ? "primary" : "")}
              onClick={() => setPlaying(!playing)}
              disabled={!hasMotion}
              title={hasMotion ? undefined : design.kind === "lamp" ? "Change Joint angle in Dimensions to adjust the lamp." : "Set up joints in Engineering & versions, then Mechanisms."}
              aria-label={playing ? "Pause mechanism" : "Run mechanism"}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
              <span className={!playing && !hasMotion && design.kind !== "lamp" ? "sr-only" : undefined}>{playing ? "Pause" : hasMotion ? "Try it" : design.kind === "lamp" ? "Static pose" : "No motion set"}</span>
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
                disabled={!hasMotion}
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
            <span className="pointer-hint">Drag to rotate / Scroll to zoom / Select a part to inspect</span>
            <span className="touch-hint">Drag to rotate / Pinch to zoom / Tap a part to inspect</span>
          </p>
        </section>
        {tab === "design" && (
          <div
            className="mobile-editor-switch"
            role="group"
            aria-label="Editing tools"
          >
            <button className={mobileEditor === "canvas" ? "active" : ""} onClick={() => setMobileEditor("canvas")}><Box size={16} /> Model</button>
            <button
              data-panel="right"
              className={mobileEditor === "dimensions" ? "active" : ""}
              onClick={() => setMobileEditor("dimensions")}
            >
              <Settings2 size={16} /> <span aria-hidden="true">Size</span><span className="sr-only">Dimensions</span>
            </button>
            <button
              data-panel="left"
              className={mobileEditor === "prompt" ? "active" : ""}
              onClick={() => { setMobileEditor("prompt"); setEditorMode("prompt"); }}
            >
              <MessageSquare size={16} /> <span aria-hidden="true">Change</span><span className="sr-only">Describe a change</span>
            </button>
          </div>
        )}
        <aside className="right-panel" id="studio-right-panel" onKeyDown={(event) => { if (event.key === "Escape" && !(event.target as HTMLElement).closest('[role="dialog"]')) { setRightPanelOpen(false); setMobileEditor("canvas"); requestAnimationFrame(() => { const selectors = window.innerWidth <= 820 && tab === "design" ? '.mobile-editor-switch [data-panel="right"]' : '[aria-controls="studio-right-panel"]'; document.querySelector<HTMLButtonElement>(selectors)?.focus(); }); } }}>
          {tab === "design" ? (
            <>
              <div className="panel-heading">
                <h2>Dimensions</h2>
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
                        disabled={readOnly || busy || spec.min === spec.max}
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
                        disabled={readOnly || busy || spec.min === spec.max}
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
                      <button
          className="button quiet small"
          onClick={() => void fork()}
          disabled={busy}
        >
          <Copy size={15} /> Make a copy
        </button>

              <details className="consequences"><summary>Design measurements</summary>

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
              </details>
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
                    onClick={() => { selectParts(createSelection(snapshot, [p.id], "click")); }}
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
              <div className="assembly-progress">
                <span>
                  {completed.length} of {derived.steps.length} steps reviewed
                </span>
                <progress value={completed.length} max={derived.steps.length} />
              </div>
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
                      onClick={() => { selectParts(createSelection(snapshot, [p.id], "click")); }}
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
              restoring={buildRestoring}
              statusError={buildStatusError}
              busy={busy}
              token={token}
              readOnly={!!readOnly}
              onBuild={() => void build()}
            />
          )}
        </aside>
      </main>
      {notes && (
        <div className="notes-drawer" id="shared-notes-drawer" role="region" aria-label="Shared notes" onKeyDown={(event) => { if (event.key === "Escape" && !(event.target as HTMLElement).closest('[role="dialog"]')) { setNotes(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Open shared notes"]')?.focus()); } }}>
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
              setLeftPanelOpen(true); setRightPanelOpen(false);
            }}
          />
        </div>
      )}
      {room && <RoomSheet designId={id} token={token} readOnly={!!readOnly} onClose={() => setRoom(false)} />}
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
  restoring,
  statusError,
  busy,
  token,
  readOnly,
  onBuild,
}: {
  snapshot: Snapshot;
  job: BuildJob | null;
  restoring: boolean;
  statusError: string;
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
      <p className="subtle">CAD files, drawings, parts lists and assembly instructions for revision {design.revision}.</p>
      <details className="package-contents"><summary>Files included</summary><ul className="package-list">
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
      </ul></details>
      <button
        data-testid="generate-build"
        className="button primary wide"
        onClick={onBuild}
        disabled={busy || restoring || !!working || readOnly}
      >
        {working || busy ? (
          <Loader2 className="spin" size={17} />
        ) : (
          <PackageOpen size={17} />
        )}{" "}
        {working ? "Preparing files…" : "Prepare build package"}
      </button>
      {restoring && <p role="status" className="subtle">Checking existing package…</p>}
      {statusError && <p role="alert" className="error">{statusError}</p>}
      {job?.status === "ready" && (
        <div className="build-ready">
          <CheckCircle2 size={23} />
          <h3>Your files are ready.</h3>
          <p>
            Revision {job.revision}
            {job.revision !== design.revision
              ? " / An earlier version of this design"
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
          {!readOnly && (
            <button className="button small" disabled={busy || restoring} onClick={onBuild}>
              Try again
            </button>
          )}
        </div>
      )}
      <details className="parts-disclosure">
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
                  {b.material} / {b.process}
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
