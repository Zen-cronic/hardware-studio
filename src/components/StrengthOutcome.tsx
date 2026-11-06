import type { StudyJob } from '../lib/strengthSetup';

export default function StrengthOutcome({ job, result, nextMeshSize, refineError, busy, onRefine }: {
  job: StudyJob; result: any; nextMeshSize?: number; refineError: string; busy: boolean; onRefine: () => void;
}) {
  if (job.type !== 'strength' || job.status !== 'ready' || !result) return null;
  const convergence = result.convergence;
  return <div className="strength-outcome" aria-label="Strength result summary">
    {job.stale && <p className="strength-input-error">This result belongs to an earlier design. Review a new study on the current revision.</p>}
    {convergence && <>
      <p>{convergence.status === 'converged' ? 'Displacement and 95th-percentile stress stabilized within the chosen mesh checks.' : convergence.status === 'unconverged' ? 'The result still changes as the mesh gets finer. Refine it before relying on these values.' : 'Mesh convergence was not checked. These values are preliminary.'}</p>
      {Number.isFinite(convergence.displacementRelativeChange) && <dl className="study-metrics">
        <div><dt>Displacement change / target &lt;2%</dt><dd>{(100 * convergence.displacementRelativeChange).toFixed(2)}%</dd></div>
        <div><dt>95th-percentile stress change / target &lt;5%</dt><dd>{(100 * convergence.p95StressRelativeChange).toFixed(2)}%</dd></div>
      </dl>}
      <p className="strength-note">Convergence checks numerical stability. It does not certify physical safety, joint behavior or manufacturing readiness.</p>
    </>}
    {result.status === 'unconverged' && <div className="strength-refine">
      {nextMeshSize !== undefined && <p>Rerun this component at revision {job.revision}, starting at {Number(nextMeshSize.toFixed(6))} mm with 2 refinements. Its recorded material, supports and force stay the same, even if you edit the setup form.</p>}
      <button className="button primary wide" disabled={busy || nextMeshSize === undefined} onClick={onRefine}>Refine and rerun</button>
      {refineError && <p role="status">{refineError}</p>}
    </div>}
  </div>;
}
