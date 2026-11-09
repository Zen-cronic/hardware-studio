import type { AgentRun, RecordedAgentOperation, RecordedPartChange, RecordedStudyOutcome, VersionOutcomes } from "../shared/versions";
const roleName = { designer: "Designer", engineer: "Engineer", external: "External agents" };
const statusName = (status: string) => ({ needs_input: "Needs input", unsupported_physics: "Unsupported physics", needs_inputs: "Needs inputs", invalid_geometry: "Invalid geometry", mesh_failed: "Mesh failed" } as Record<string, string>)[status] || status.replaceAll("_", " ");
const size = (value?: number[]) => value?.join(" × ");
function PartOutcome({ part }: { part: RecordedPartChange }) {
  const resized = part.beforeSize && part.afterSize && size(part.beforeSize) !== size(part.afterSize);
  const diameter = part.holesUnchanged && new Set(part.holesUnchanged.diameters).size === 1 ? part.holesUnchanged.diameters[0] : undefined;
  return <div className="agent-part-outcome"><strong>{part.name}</strong>
    <p>{resized ? <><span className="outcome-measure">{size(part.beforeSize)} → {size(part.afterSize)} mm</span></> : part.type === "changed" ? `Changed: ${part.fields.join(", ")}.` : `${part.type === "added" ? "Added" : "Removed"} component.`}</p>
    {resized && part.fields.some(field => field !== "size") && <p className="outcome-secondary">Also changed: {part.fields.filter(field => field !== "size").join(", ")}.</p>}
    {part.holesUnchanged && <p className="outcome-secondary">{part.holesUnchanged.count}{diameter !== undefined ? ` × Ø${diameter} mm` : ""} holes unchanged, including positions and counterbores.</p>}
  </div>;
}
function OperationOutcome({ operation }: { operation: RecordedAgentOperation }) {
  return <div className="agent-operation"><p className="outcome-revision">r{operation.fromRevision} → r{operation.toRevision}{operation.action === "undo" ? ", Undo" : ""}</p>
    {!operation.hasChanges ? <p>No additional geometry change.</p> : <>
      {operation.parts.map(part => <PartOutcome key={part.partId} part={part} />)}
      {operation.parameters.length > 0 && <p className="outcome-secondary">Parameters: {operation.parameters.map(p => `${p.key} ${p.before ?? "—"} → ${p.after ?? "—"}`).join("; ")}.</p>}
    </>}
  </div>;
}
function staleLabel(study: RecordedStudyOutcome) {
  return study.staleReason === "source_changed" ? "Source changed" : study.staleReason === "different_revision" ? "Different revision" : "Earlier design";
}
function StudyOutcome({ study }: { study: RecordedStudyOutcome }) {
  const profile = study.profile;
  return <li><strong>{study.partName || (study.partId ? "Recorded component" : "Imported component")}</strong>
    <span>{study.type}, r{study.revision}</span><span>{statusName(study.status)}{study.status === "ready" ? ` / ${study.resultStatus ? statusName(study.resultStatus) : "result unavailable"}` : ""}{study.findingCount !== undefined ? ` / ${study.findingCount} findings` : ""}</span>{study.stale && <span className="outcome-badge">{staleLabel(study)}</span>}
    {profile && <div><strong>Process profile</strong>{profile.name && <p>{profile.name}</p>}<dl className="outcome-profile">{([
      ["Minimum wall", profile.minWallMm, "mm"], ["Minimum hole", profile.minHoleMm, "mm"],
      ["Maximum hole aspect ratio", profile.maxHoleAspect, ""], ["Tool diameter", profile.toolDiameterMm, "mm"],
      ["Tool reach", profile.toolReachMm, "mm"], ["Machine envelope", profile.buildEnvelopeMm?.join(" × "), "mm"],
    ] as const).filter(([,value]) => value !== undefined).map(([label,value,unit]) => <div key={label}><dt>{label}</dt><dd>{value} {unit}</dd></div>)}</dl></div>}
    {study.checksPerformed?.length ? <p><strong>Checks performed:</strong> {study.checksPerformed.join("; ")}.</p> : null}
    {study.assumptions?.map((value,index) => <p key={`assumption-${index}`}><strong>Assumption:</strong> {value === "Checks compare the current geometry to the displayed process profile." ? `Checks compare the recorded r${study.revision} geometry to the displayed process profile.` : value}</p>)}
    {study.unassessed?.map((value,index) => <p key={`unassessed-${index}`}><strong>Not assessed:</strong> {value}</p>)}
  </li>;
}
export default function AgentOutcomes({ outcomes, revision, runs }: { outcomes: VersionOutcomes | null; revision: number; runs: AgentRun[] }) {
  if (!outcomes || outcomes.proposedRevision !== revision) return <section className="agent-outcomes" aria-label="Recorded agent outcomes"><p role="status">Loading recorded outcomes…</p></section>;
  const studies = outcomes.studies;
  const ready = studies.filter(s => s.status === "ready"), solved = ready.filter(s => s.resultStatus === "solved");
  const earlier = studies.filter(s => s.staleReason === "earlier_revision");
  const sourceChanged = studies.filter(s => s.staleReason === "source_changed");
  const different = studies.filter(s => s.staleReason === "different_revision");
  const findingsKnown = solved.length > 0 && solved.every(s => s.findingCount !== undefined);
  const revisions = [...new Set(studies.map(s => s.revision))].sort((a,b) => a-b);
  const counts = (values: string[]) => Object.entries(values.reduce<Record<string,number>>((all, value) => {all[value] = (all[value] || 0) + 1;return all;}, {})).map(([value,count]) => `${count} ${statusName(value)}`).join(", ");
  const latest = runs[0];
  return <section className="agent-outcomes" aria-label="Recorded agent outcomes">
    <h3>What changed</h3><p className="outcome-secondary">Recorded contributions across this proposed version.</p>
    {outcomes.contributions.map(contribution => {
      const changed = contribution.operations.filter(o => o.hasChanges), lead = changed.at(-1) || contribution.operations.at(-1);
      return <article className="agent-role-outcome" key={contribution.role} aria-label={`${roleName[contribution.role]} contribution`}>
        <h4>{roleName[contribution.role]}</h4>
        {lead ? <OperationOutcome operation={lead} /> : <p>No saved edit recorded.</p>}
        {contribution.operations.length > 1 && <details><summary>{contribution.operations.length} recorded operations</summary>{contribution.operations.map(operation => <OperationOutcome key={operation.operationId} operation={operation} />)}</details>}
      </article>;
    })}
    <div className="version-study-outcomes"><h4>Saved studies</h4>
      {!studies.length ? <p>No saved studies for this proposed version.</p> : <>
        <p>{studies.length}{studies.every(s => s.type === "manufacturing") ? " manufacturing" : ""} {studies.length === 1 ? "study" : "studies"}, {revisions.map(r => `r${r}`).join(", ")}</p>
        {earlier.length > 0 && <p><span className="outcome-badge">Earlier design</span> {earlier.length} {earlier.length === 1 ? "study predates" : "studies predate"} current r{revision}.</p>}
        {sourceChanged.length > 0 && <p><span className="outcome-badge">Source changed</span> {sourceChanged.length} {sourceChanged.length === 1 ? "study needs" : "studies need"} review after a source change at r{revision}.</p>}
        {different.length > 0 && <p><span className="outcome-badge">Different revision</span> {different.length} {different.length === 1 ? "study is" : "studies are"} from another revision.</p>}
        <p className="outcome-secondary">{counts(studies.map(s => s.status))}{ready.length > 0 ? `, ${counts(ready.map(s => s.resultStatus || "result unavailable"))}` : ""}{findingsKnown ? `, ${solved.reduce((n,s) => n + s.findingCount!, 0)} findings in solved studies` : ""}.</p>
        <details><summary>Inspect saved study results</summary><ul>{studies.map(study => <StudyOutcome key={study.id} study={study} />)}</ul>{studies.length === outcomes.studyLimit && <p className="outcome-secondary">Showing the latest {outcomes.studyLimit} studies.</p>}</details>
      </>}
      <p className="outcome-secondary">Studies belong to the version; their records do not identify an agent or run. Results cover their recorded revision and inputs.</p>
    </div>
    <div className="agent-run-status"><h4>Run status</h4><p>{latest ? `Latest run: ${statusName(latest.status)}.` : "No agent runs recorded."}</p>
      {runs.length > 0 && <details><summary>Run history and inputs ({runs.length})</summary>{runs.map(run => <article key={run.id}><strong>{statusName(run.status)}{run.modelBacked ? ", model-backed" : ""}</strong><p>Completed roles: {run.completedRoles.length ? run.completedRoles.map(role => roleName[role]).join(", ") : "none"}.</p>{run.error && <p>{run.error}</p>}{run.questions.map((question,i) => <p key={i}>{question}</p>)}<p className="outcome-secondary">Input: {run.goal}</p></article>)}</details>}
    </div>
  </section>;
}
