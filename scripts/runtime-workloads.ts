/** Actual disposable application workloads; no provider, original data or public host. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { arch, homedir, platform, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';
import { createApp } from '../server/app';

const args = new Set(process.argv.slice(2));
assert([...args].every(value => value === '--require-linux'), 'Only --require-linux is supported.');
if (args.has('--require-linux')) assert(platform() === 'linux' && arch() === 'x64', 'Requires actual Linux x64.');
assert(!process.env.OPENAI_API_KEY, 'Run without a provider key.');
process.umask(0o077);
const exec = promisify(execFile);
const python = process.env.CAD_PYTHON || join(homedir(), '.pyenv/versions/.victoria-hardware/bin/python');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hardware-workloads-')));
const data = join(root, 'data');
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const checks: { name: string; elapsedSeconds: number; evidence: unknown }[] = [];
const started = Date.now();
let runtime: Awaited<ReturnType<typeof createApp>> | undefined;
let peakProcessTreeRssBytes = 0, minFreeDiskBytes = Infinity, sampling = false;
let sampleCount = 0;
async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 5000 });
    const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const ids = new Set([process.pid]);
    for (let size = -1; size !== ids.size;) {
      size = ids.size;
      for (const [pid, parent] of rows) if (ids.has(parent)) ids.add(pid);
    }
    peakProcessTreeRssBytes = Math.max(peakProcessTreeRssBytes, rows.filter(([pid]) => ids.has(pid)).reduce((sum, row) => sum + row[2] * 1024, 0));
    const disk = statfsSync(root);
    minFreeDiskBytes = Math.min(minFreeDiskBytes, disk.bavail * disk.bsize);
    sampleCount++;
  } catch { /* Measurement is supplementary; its availability is explicit below. */ }
  finally { sampling = false; }
}
const timer = setInterval(() => void sample(), 1000);
timer.unref();
async function check(name: string, run: () => Promise<unknown>) {
  const before = Date.now();
  const evidence = await run();
  checks.push({ name, elapsedSeconds: (Date.now() - before) / 1000, evidence });
  process.stdout.write(JSON.stringify({ check: name, ok: true, elapsedSeconds: checks.at(-1)!.elapsedSeconds }) + '\n');
}
async function start(directory: string) {
  runtime = await createApp({ dataDir: directory, python, aiKey: '', aiPolicy: { budgetUsd: 0, reservationUsd: 1 } });
  await runtime.app.listen({ host: '127.0.0.1', port: 0 });
}
async function request(path: string, token = '', payload?: Record<string, unknown>) {
  const response = await runtime!.app.inject({ method: payload === undefined ? 'GET' : 'POST', url: '/api' + path, headers: token ? { authorization: 'Bearer ' + token } : {}, ...(payload === undefined ? {} : { payload }) });
  assert(response.statusCode >= 200 && response.statusCode < 300, `Request ${path} failed with ${response.statusCode}: ${response.body.slice(0, 300)}`);
  return response;
}
async function job(path: string, token: string, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = (await request(path, token)).json();
    const status = value.latestJob?.status ?? value.status;
    if (status === 'ready') return value;
    assert(['queued', 'running'].includes(status), `Workload failed: ${JSON.stringify(value.error || value.latestJob?.error || status)}`);
    assert(Date.now() < deadline, `Workload deadline: ${path}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
}
function directoryBytes(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? directoryBytes(join(directory, entry.name)) : statSync(join(directory, entry.name)).size), 0);
}
let failure: string | undefined;
try {
  await start(data);
  const health = (await request('/health')).json(); assert.equal(health.ai, false); assert.equal(health.cad, true);
  const part = { id: 'beam', name: 'Rehearsal link', shape: 'box', size: [100, 5, 10], position: [0, 0, 0], color: '#4e8ac9', material: 'Aluminum', process: 'machine', holes: [{ x: -35, z: 0, diameter: 3 }, { x: 35, z: 0, diameter: 3 }] };
  const created = (await request('/designs', '', { kind: 'custom', name: 'Runtime rehearsal link', customParts: [part] })).json();
  const id = created.snapshot.design.id, token = created.access.editorToken, viewer = created.access.viewerToken;
  // Exercise a real revision, then retain notes through reopen and relocation.
  await request(`/designs/${id}/commands`, token, { id: 'rehearsal-thickness', actor: 'Runtime check', baseRevision: 0, changes: {}, readSet: created.snapshot.design.params, customParts: [{ ...part, size: [100, 6, 10] }] });
  const note = new Y.Doc(); note.getText('notes').insert(0, 'Keep both mounting holes.');
  runtime!.store.db.prepare('INSERT INTO documents VALUES(?,?)').run(id, Buffer.from(Y.encodeStateAsUpdate(note))); note.destroy();
  let build: any, study: any, imported: any, clip: any;
  let packageHash = '', originalHash = '', clipHash = '';
  await check('actual-cad-package', async () => {
    build = (await request(`/designs/${id}/build`, token, {})).json();
    build = await job('/builds/' + build.id, token);
    assert.equal(build.revision, 1);
    const bytes = (await request(`/builds/${build.id}/download`, viewer)).rawPayload;
    packageHash = digest(bytes);
    const archive = join(root, 'package.zip'); writeFileSync(archive, bytes);
    const { stdout } = await exec(python, ['-c', "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n m=json.loads(z.read('manifest.json'))\n assert m['revision']==1 and m['assemblyVerification']['valid']\n assert {'assembly.step','bom.csv','assembly.md','manifest.json'}<=set(z.namelist())\n print(json.dumps({'solids':m['assemblyVerification']['solids'],'parts':len(m['parts']),'artifactCount':len(m['artifacts'])}))", archive], { timeout: 30000 });
    return { revision: build.revision, sha256: packageHash, bytes: bytes.length, package: JSON.parse(stdout) };
  });
  await check('actual-strength-study', async () => {
    study = (await request(`/designs/${id}/studies`, token, { type: 'strength', revision: 1, partId: 'beam', material: { name: 'Example aluminum', youngModulusMPa: 70000, poissonRatio: .3, densityKgM3: 2700 }, supports: [{ axis: 'x', side: 'min' }], loads: [{ axis: 'x', side: 'max', forceN: [0, -1, 0] }], mesh: { maxSizeMm: 4, refinements: 0 } })).json();
    study = await job('/studies/' + study.id, token);
    assert.equal(study.result.status, 'solved'); assert.equal(study.revision, 1); assert(study.result.maxDisplacementMm > 0); assert(study.result.mesh.surface.length > 0);
    return { revision: study.revision, resultStatus: study.result.status, maxDisplacementMm: study.result.maxDisplacementMm, inputHash: study.result.inputHash, surfaceCount: study.result.mesh.surface.length };
  });
  await check('actual-step-import-and-reconstruction', async () => {
    const source = join(root, 'original.step');
    await exec(python, ['-c', "import cadquery as cq,sys\nfrom cad.geometry import local_shape\np={'id':'source','name':'Source','shape':'box','size':[40,8,20],'position':[0,0,0],'color':'#4e8ac9','material':'Aluminum','process':'machine','holes':[{'x':0,'z':0,'diameter':4}]}\ncq.exporters.export(local_shape(p),sys.argv[1])", source], { timeout: 60000 });
    const bytes = readFileSync(source); originalHash = digest(bytes);
    imported = (await request(`/designs/${id}/imports`, token, { filename: 'original.step', contentBase64: bytes.toString('base64'), scaleToMm: 1 })).json();
    imported = await job('/imports/' + imported.id, token);
    assert.equal(imported.latestJob.result.bodyCount, 1);
    await request(`/imports/${imported.id}/reconstruct`, token, { bodyIndex: 0, scaleToMm: 1, toleranceMm: .1 });
    imported = await job('/imports/' + imported.id, token);
    assert.equal(imported.latestJob.result.status, 'reconstructed'); assert.equal(imported.latestJob.result.fit.accepted, true);
    const accepted = (await request(`/imports/${imported.id}/accept`, token, { jobId: imported.latestJobId, expectedInputHash: imported.latestJob.result.inputHash })).json();
    assert.equal(accepted.snapshot.design.kind, 'custom'); assert.equal(accepted.snapshot.derived.parts[0].holes[0].diameter, 4);
    assert.equal(digest((await request(`/imports/${imported.id}/original`, viewer)).rawPayload), originalHash);
    return { sourceHash: originalHash, resultStatus: imported.latestJob.result.status, acceptedMeasuredHoleDiameterMm: 4, fit: imported.latestJob.result.fit };
  });
  await check('actual-product-film', async () => {
    clip = (await request(`/designs/${id}/clips`, token, { revision: 1 })).json();
    clip = await job('/clips/' + clip.id, token, 735000);
    assert.equal(clip.frame, 600); assert.equal(clip.format.durationSeconds, 20);
    const bytes = (await request(`/clips/${clip.id}/download`, viewer)).rawPayload;
    clipHash = digest(bytes); const filename = join(root, 'product.mp4'); writeFileSync(filename, bytes);
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,r_frame_rate:format=duration', '-of', 'json', filename], { timeout: 30000 });
    const probe = JSON.parse(stdout), video = probe.streams.find((stream: any) => stream.codec_name === 'h264');
    assert(video); assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(Number(video.nb_frames), 600); assert(Math.abs(Number(probe.format.duration) - 20) < .05);
    return { revision: clip.revision, snapshotHash: clip.snapshotHash, sha256: clipHash, bytes: bytes.length, probe };
  });
  await check('stopped-backup-restore-and-downloads', async () => {
    const originalSnapshot = runtime!.store.get(id);
    assert.equal((runtime!.store.db.prepare('SELECT COUNT(*) AS count FROM ai_usage').get() as { count: number }).count, 0);
    await runtime!.app.close(); runtime = undefined;
    const snapshot = join(root, 'snapshot'), restored = join(root, 'restored');
    for (const argumentsList of [ ['backup', '--source', data, '--destination', snapshot, '--confirm-stopped'], ['verify', '--source', snapshot], ['restore', '--source', snapshot, '--destination', restored, '--confirm-stopped'] ]) {
      await exec(python, [resolve('scripts/data-snapshot.py'), ...argumentsList], { timeout: 90000 });
    }
    // Remove only this script's original temporary tree so stale pointers cannot pass.
    rmSync(data, { recursive: true });
    await start(restored);
    assert.deepEqual(runtime!.store.get(id), originalSnapshot);
    for (const [path, expected] of [ [`/builds/${build.id}/download`, packageHash], [`/imports/${imported.id}/original`, originalHash], [`/clips/${clip.id}/download`, clipHash] ]) assert.equal(digest((await request(path, viewer)).rawPayload), expected);
    const savedStudy = (await request('/studies/' + study.id, viewer)).json(); assert.equal(savedStudy.result.inputHash, study.result.inputHash); assert.equal(savedStudy.stale, false);
    const restoredNote = new Y.Doc(); const row = runtime!.store.db.prepare('SELECT content FROM documents WHERE id=?').get(id) as { content: Buffer };
    Y.applyUpdate(restoredNote, row.content); assert.equal(restoredNote.getText('notes').toString(), 'Keep both mounting holes.'); restoredNote.destroy();
    const unauthorized = await runtime!.app.inject({ url: `/api/builds/${build.id}/download` }); assert.equal(unauthorized.statusCode, 403);
    return { originalTemporaryDataRemoved: true, savedRevision: originalSnapshot.design.revision, byteIdenticalDownloads: ['CAD package', 'original STEP', 'product MP4'], studyHashPreserved: true, savedNotePreserved: true, viewerDownloadAuthorized: true, anonymousDownloadRejected: true };
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await runtime?.app.close();
  await sample(); clearInterval(timer);
  const receipt = { scope: 'disposable-application-workloads', ok: !failure, ...(failure ? { error: failure } : {}), checkedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), platform: platform(), architecture: arch(), elapsedSeconds: (Date.now() - started) / 1000, totalMemoryBytes: totalmem(), sampledPeakProcessTreeRssBytes: sampleCount ? peakProcessTreeRssBytes : null, processSampleCount: sampleCount, minimumObservedFreeDiskBytes: sampleCount ? minFreeDiskBytes : null, temporaryOutputBytes: directoryBytes(root), checks, limits: ['Generated disposable fixtures; no existing user design or provider request.', 'Memory is a one-second sampled sum of this process and descendants; shared pages can be double-counted and brief peaks missed.', 'Cancellation regressions run separately; this script completes native jobs.', 'No systemd/persistent-host, public HTTPS, two-browser Notes or uptime proof.', 'Output files are removed after verification; only sanitized receipts remain in logs.'] };
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  rmSync(root, { recursive: true, force: true });
}
