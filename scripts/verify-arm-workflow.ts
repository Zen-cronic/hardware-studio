/** Resume a genuine saved arm proposal in a disposable database; no provider calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import fastifyStatic from '@fastify/static';
import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { createApp, createCollaborationServer } from '../server/app';
import { canonicalClipSource } from '../src/lib/clip-timeline';
import type { Snapshot } from '../src/shared/types';

const { values } = parseArgs({ options: { 'source-db': { type: 'string' }, bundle: { type: 'string' }, output: { type: 'string' }, port: { type: 'string', default: '4199' }, resume: { type: 'boolean', default: false } } });
assert(values['source-db'] && values.bundle && values.output, 'Provide --source-db, --bundle and --output.');
const sourcePath = resolve(values['source-db']), bundle = resolve(values.bundle), output = resolve(values.output);
const port = Number(values.port), notesPort = port + 1, base = `http://127.0.0.1:${port}`;
assert(Number.isInteger(port) && port > 1024 && port < 65535);
assert(![4174, 4175, 4176, 4177].includes(port) && ![4174, 4175, 4176, 4177].includes(notesPort));
assert(existsSync(join(bundle, 'index.html')), 'Build the production bundle first.');
assert(!output.startsWith(sourcePath + '/'));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
function sourceReceipt() {
  const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'src', 'server', 'cad', 'scripts', 'package.json', 'package-lock.json', 'pyproject.toml', 'poetry.lock', '.python-version', 'tsconfig.json', 'vite.config.ts'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  const files = paths.map(path => ({ path: resolve(path), sha256: digest(readFileSync(path)) }));
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trimEnd();
  return { at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), dirty: !!status, changed: status.split('\n').filter(Boolean).map(line => ({ status: line.slice(0, 2), path: resolve(line.slice(3)) })), scope: 'Application, server, CAD, scripts, package/lock and compiler files; private data and credentials excluded.', treeSha256: digest(JSON.stringify(files)), files };
}
const tables = ['designs', 'operations', 'proposed_versions', 'agent_events', 'agent_runs', 'agent_credentials', 'engineering_jobs', 'ai_usage'];
function fingerprints(db: Database.Database) {
  return Object.fromEntries(tables.map(table => [table, digest(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))]));
}
const source = new Database(sourcePath, { readonly: true });
const original = fingerprints(source);
const completed = (source.prepare('SELECT run FROM agent_runs').all() as { run: string }[]).map(r => JSON.parse(r.run)).filter(r => r.status === 'completed' && r.completedRoles.includes('designer') && r.completedRoles.includes('engineer'));
assert.equal(completed.length, 1, 'Choose a source database with exactly one genuine completed two-role proposal.');
const sourceRun = completed[0];
const version = JSON.parse((source.prepare('SELECT record FROM proposed_versions WHERE id=?').get(sourceRun.versionId) as { record: string }).record);
assert.equal(version.status, 'open', 'The original proposal must still be reviewable.');
const data = join(output, 'data');
if (!values.resume) {
  assert(!existsSync(output), 'Choose a fresh output directory, or explicitly --resume.');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  await source.backup(join(data, 'studio.sqlite'));
} else assert(existsSync(join(data, 'studio.sqlite')));
const { app, store } = await createApp({ dataDir: data, serveStatic: false, aiKey: '' });
await app.register(fastifyStatic, { root: bundle, prefix: '/' });
app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'API route not found.' }) : reply.sendFile('index.html'));
const notes = createCollaborationServer(store, notesPort);
await notes.listen(); await app.listen({ host: '127.0.0.1', port });
async function servedBundleReceipt() {
  const response = await fetch(base + '/'); assert(response.ok);
  const html = Buffer.from(await response.arrayBuffer()); assert.deepEqual(html, readFileSync(join(bundle, 'index.html')));
  const paths = [...html.toString().matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]);
  assert(paths.some(path => path.endsWith('.js')) && paths.some(path => path.endsWith('.css')));
  const files = [{ path: join(bundle, 'index.html'), servedPath: '/', sha256: digest(html) }];
  for (const path of paths) {
    const response = await fetch(base + path); assert(response.ok);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes, readFileSync(join(bundle, path)));
    files.push({ path: join(bundle, path), servedPath: path, sha256: digest(bytes) });
  }
  return { origin: base, httpBytesMatchDisk: true, files, hash: digest(JSON.stringify(files)) };
}
const sourceStart = sourceReceipt(), servedStart = await servedBundleReceipt();
write('source-start.json', { resumed: values.resume, source: sourceStart, servedBundle: servedStart });
const access = (id: string) => store.db.prepare('SELECT editor_token,viewer_token FROM designs WHERE id=?').get(id) as { editor_token: string; viewer_token: string };
const parentAccess = access(version.parentDesignId), proposalAccess = access(version.proposedDesignId);
const headers = (token: string) => ({ authorization: 'Bearer ' + token });
const stateFile = join(output, 'state.json');
const state: any = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { pairs: [], sourceRunId: sourceRun.id, versionId: version.id };
const checkpoint = () => write('state.json', state);
const api = async (path: string, token: string) => {
  const response = await fetch(base + '/api' + path, { headers: headers(token) });
  assert(response.ok, `GET ${path}: ${response.status}`); return response.json() as Promise<any>;
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
// The installed local bundle defaults notes to4175. Keep all collaboration in this disposable store.
await context.routeWebSocket('ws://127.0.0.1:4175/**', route => {
  const upstream = new WebSocket(`ws://127.0.0.1:${notesPort}/`), pending: (string | Buffer)[] = [];
  route.onMessage(message => { if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else pending.push(message); });
  upstream.on('open', () => { for (const message of pending.splice(0)) upstream.send(message); });
  upstream.on('message', (message, binary) => route.send(binary ? Buffer.from(message as Buffer) : message.toString()));
  upstream.on('error', () => route.close());
  upstream.on('close', () => route.close());
  route.onClose(() => { if (upstream.readyState === WebSocket.OPEN) upstream.close(); else upstream.once('open', () => upstream.close()); });
});
await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
const page = await context.newPage(), pageErrors: string[] = [], writes: { method: string; path: string }[] = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('request', r => { if (r.method() !== 'GET') writes.push({ method: r.method(), path: new URL(r.url()).pathname }); });
const develop = (id: string, token: string) => `${base}/develop/${id}?part=upper-arm#token=${token}`;
const screenshot = (name: string) => page.screenshot({ path: join(output, name), fullPage: true });
let timer: ReturnType<typeof setInterval> | undefined;
try {
  const view = await api('/proposed-versions/' + version.id, parentAccess.editor_token);
  if (!values.resume) {
    assert.equal(view.main.design.revision, 0); assert.equal(view.proposed.design.revision, 2);
    assert.deepEqual(view.diff.parts.map((p: any) => ({ id: p.partId, fields: p.fields })), [{ id: 'upper-arm', fields: ['size'] }]);
    const before = view.main.derived.parts.find((p: any) => p.id === 'upper-arm'), after = view.proposed.derived.parts.find((p: any) => p.id === 'upper-arm');
    assert.equal(before.size[1], 4); assert.equal(after.size[1], 6);
    assert.deepEqual(before.holes, after.holes);
    write('before-snapshot.json', view.main); write('proposed-snapshot.json', view.proposed);
    write('lineage.json', { sourceDatabase: sourcePath, sourceTableHashes: original, backupMethod: 'SQLite online backup into a new disposable store; no rewritten snapshots or synthesized provider events.', version: view.version, sourceRun: { id: sourceRun.id, status: sourceRun.status, completedRoles: sourceRun.completedRoles }, originalBefore: { id: view.main.design.id, revision: 0 }, originalProposal: { id: view.proposed.design.id, revision: 2 }, diff: view.diff, newProviderCalls: 0 });
  }
  async function study(id: string, token: string, meshSize: number, phase: string, previousId?: string) {
    if (previousId) return api('/studies/' + previousId, token);
    await page.goto(develop(id, token));
    await page.getByRole('combobox', { name: 'Study', exact: true }).selectOption('strength');
    await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('upper-arm');
    await page.getByRole('spinbutton', { name: 'Test payload (kg)', exact: true }).fill('0.5');
    await page.getByRole('combobox', { name: 'Cantilever axis', exact: true }).selectOption('x');
    await page.getByRole('combobox', { name: 'Fixed end', exact: true }).selectOption('min');
    await page.getByRole('combobox', { name: 'Loaded end', exact: true }).selectOption('max');
    await page.getByRole('combobox', { name: 'Force direction', exact: true }).selectOption('-y');
    await page.getByRole('spinbutton', { name: 'Starting mesh size (mm)', exact: true }).fill(String(meshSize));
    await page.getByRole('combobox', { name: 'Mesh refinements', exact: true }).selectOption('2');
    await page.getByRole('checkbox', { name: /I reviewed this component/ }).check();
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/designs/${id}/studies`));
    await page.getByRole('button', { name: 'Run study', exact: true }).click();
    const submitted = await response; assert.equal(submitted.status(), 202);
    const job = await submitted.json();
    const pair = state.pairs.find((p: any) => p.meshSize === meshSize); pair[phase + 'Id'] = job.id; checkpoint();
    await expect.poll(async () => (await api('/studies/' + job.id, token)).status, { timeout: 240000, intervals: [1000, 2000] }).toBe('ready');
    const result = await api('/studies/' + job.id, token);
    write(`${phase}-mesh-${meshSize}.json`, result);
    await expect(page.locator('.study-result')).toContainText(/Mesh convergence passed|More mesh refinement needed/, { timeout: 12000 });
    await page.locator('.study-result').screenshot({ path: join(output, `${phase}-mesh-${meshSize}.png`) });
    return result;
  }
  let matched: { before: any; after: any } | undefined;
  for (const meshSize of [4, 3, 2.5]) {
    let pair = state.pairs.find((p: any) => p.meshSize === meshSize);
    if (!pair) { pair = { meshSize }; state.pairs.push(pair); checkpoint(); }
    console.log(JSON.stringify({ phase: 'matched component studies', startingMeshMm: meshSize }));
    const before = await study(version.parentDesignId, parentAccess.editor_token, meshSize, 'before', pair.beforeId);
    const after = await study(version.proposedDesignId, proposalAccess.editor_token, meshSize, 'after', pair.afterId);
    assert.deepEqual(before.setup, after.setup, 'The comparison must use identical declared inputs.');
    assert.deepEqual(before.setup.loads, [{ axis: 'x', side: 'max', forceN: [0, -4.903325, 0] }]);
    if (before.result.convergence?.status === 'converged' && after.result.convergence?.status === 'converged') { matched = { before, after }; break; }
  }
  assert(matched, 'Both geometries must pass mesh checks with identical setup within two refinements of the attempt.');
  const comparison = { before: { id: matched.before.id, designId: matched.before.designId, revision: matched.before.revision, thicknessMm: 4, status: matched.before.result.status, displacementMm: matched.before.result.maxDisplacementMm, p95StressMPa: matched.before.result.p95VonMisesMPa, convergence: matched.before.result.convergence }, after: { id: matched.after.id, designId: matched.after.designId, revision: matched.after.revision, thicknessMm: 6, status: matched.after.result.status, displacementMm: matched.after.result.maxDisplacementMm, p95StressMPa: matched.after.result.p95VonMisesMPa, convergence: matched.after.result.convergence }, setup: matched.before.setup, displacementReductionPercent: 100 * (1 - matched.after.result.maxDisplacementMm / matched.before.result.maxDisplacementMm), p95StressReductionPercent: 100 * (1 - matched.after.result.p95VonMisesMPa / matched.before.result.p95VonMisesMPa), physicalSafetyVerified: false };
  write('comparison.json', comparison); console.log(JSON.stringify({ phase: 'matched comparison complete', displacementReductionPercent: comparison.displacementReductionPercent, p95StressReductionPercent: comparison.p95StressReductionPercent }));
  await page.goto(develop(version.parentDesignId, parentAccess.editor_token));
  await page.getByRole('button', { name: 'Proposed versions', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(version.name + ' / (open|accepted)') }).click();
  if (!state.accepted) {
    await expect(page.getByText('Main r0 → proposed r2', { exact: true })).toBeVisible();
    await expect(page.locator('.version-changes').getByText('Upper arm link', { exact: true })).toBeVisible();
    await screenshot('review-before-acceptance.png');
    const acceptedResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/proposed-versions/${version.id}/accept`));
    await page.getByRole('button', { name: 'Accept into main design', exact: true }).click();
    const response = await acceptedResponse; assert.equal(response.status(), 200);
    state.accepted = await response.json(); checkpoint();
  }
  const accepted: Snapshot = await api('/designs/' + version.parentDesignId, parentAccess.editor_token);
  assert.equal(accepted.design.revision, 1);
  const proposed: Snapshot = JSON.parse(readFileSync(join(output, 'proposed-snapshot.json'), 'utf8'));
  assert.deepEqual(accepted.design.customParts, proposed.design.customParts);
  assert.deepEqual(accepted.derived, proposed.derived);
  write('accepted-snapshot.json', accepted); await expect(page.getByText(/Revision 1 \/ Every result/)).toBeVisible(); await screenshot('accepted-version.png');
  const acceptedVersion = await api('/proposed-versions/' + version.id, parentAccess.editor_token);
  assert.equal(acceptedVersion.version.acceptedMainRevision, 1); assert.equal(acceptedVersion.version.acceptedProposedRevision, 2);
  write('acceptance.json', { version: acceptedVersion.version, proposedSnapshotHash: acceptedVersion.proposedSnapshotHash, acceptedPartsMatchProposed: true, acceptedDerivedMatchProposed: true, uiAction: 'Actual Accept into main design button after review; automated browser, not a human usability session.' });
  console.log(JSON.stringify({ phase: 'proposal accepted through UI', acceptedRevision: 1 }));
  await page.goto(`${base}/studio/${version.parentDesignId}#token=${parentAccess.editor_token}`);
  await page.getByRole('tab', { name: 'Build', exact: true }).click();
  if (!state.buildId) {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/build'));
    await page.getByTestId('generate-build').click(); const started = await response; assert.equal(started.status(), 200);
    state.buildId = (await started.json()).id; checkpoint();
  }
  const packageDownload = page.getByRole('link', { name: 'Download package', exact: true });
  await expect(packageDownload).toBeVisible({ timeout: 180000 });
  const build = await api('/builds/' + state.buildId, parentAccess.editor_token); assert.equal(build.revision, 1); assert.equal(build.status, 'ready');
  const downloadPromise = page.waitForEvent('download'); await packageDownload.click();
  const download = await downloadPromise; await download.saveAs(join(output, 'accepted-r1-package.zip'));
  await screenshot('revision-1-package-ready.png');
  write('build.json', { ...build, archiveSha256: digest(readFileSync(join(output, 'accepted-r1-package.zip'))) });
  await page.goto(develop(version.parentDesignId, parentAccess.editor_token));
  await page.getByRole('button', { name: 'Product video', exact: true }).click();
  if (!state.clipId) {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/clips'));
    await page.getByRole('button', { name: 'Create video from revision 1', exact: true }).click();
    const started = await response; assert.equal(started.status(), 202); state.clipId = (await started.json()).id; checkpoint();
  } else await page.getByRole('combobox', { name: 'Preview', exact: true }).selectOption(state.clipId);
  timer = setInterval(() => { void api('/clips/' + state.clipId, parentAccess.editor_token).then(job => console.log(JSON.stringify({ phase: 'video render', status: job.status, frame: job.frame, total: job.totalFrames }))).catch(() => {}); }, 15000);
  await expect(page.getByRole('button', { name: 'Download MP4', exact: true })).toBeVisible({ timeout: 740000 });
  clearInterval(timer); timer = undefined;
  const clip = await api('/clips/' + state.clipId, parentAccess.editor_token), project = await api('/clips/' + state.clipId + '/project', parentAccess.editor_token);
  assert.equal(clip.revision, 1); assert.equal(clip.totalFrames, 600); assert.equal(clip.snapshotHash, digest(canonicalClipSource(accepted)));
  assert.deepEqual(project.snapshot.design, accepted.design); assert.deepEqual(project.snapshot.derived, accepted.derived);
  const videoDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download MP4', exact: true }).click();
  await (await videoDownload).saveAs(join(output, 'accepted-r1-product-20s.mp4'));
  await screenshot('revision-1-video-ready.png');
  write('clip-project.json', project); write('clip.json', { ...clip, archiveSha256: digest(readFileSync(join(output, 'accepted-r1-product-20s.mp4'))) });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,r_frame_rate,pix_fmt:format=duration', '-of', 'json', join(output, 'accepted-r1-product-20s.mp4')], { encoding: 'utf8' }));
  assert.equal(Number(probe.format.duration), 20); assert.equal(Number(probe.streams[0].nb_frames), 600);
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(output, 'accepted-r1-product-20s.mp4'), '-f', 'null', '-'], { stdio: 'pipe' });
  write('video-probe.json', probe);
  const playbackPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  playbackPage.on('pageerror', error => pageErrors.push(error.message));
  await playbackPage.goto(pathToFileURL(join(output, 'accepted-r1-product-20s.mp4')).href);
  const video = playbackPage.locator('video');
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async element => { const v = element as HTMLVideoElement; v.muted = true; v.currentTime = 0; await v.play(); });
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).ended), { timeout: 35000, intervals: [500] }).toBe(true);
  const playback = await video.evaluate(element => { const v = element as HTMLVideoElement, quality = v.getVideoPlaybackQuality(); return { ended: v.ended, duration: v.duration, error: v.error?.code ?? null, decodedFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames, width: v.videoWidth, height: v.videoHeight }; });
  assert.equal(playback.error, null); assert.equal(playback.duration, 20);
  await video.evaluate(element => { (element as HTMLVideoElement).controls = false; });
  for (const second of [0, 1, 7.5, 12.5, 19.9]) {
    await video.evaluate((element, second) => new Promise<void>(resolve => { const v = element as HTMLVideoElement; v.pause(); v.onseeked = () => resolve(); v.currentTime = second; }), second);
    await video.screenshot({ path: join(output, `encoded-video-${second}s.png`) });
  }
  await playbackPage.close(); write('video-playback.json', playback);
  assert.deepEqual(fingerprints(source), original, 'Original source database rows must remain unchanged.');
  for (const table of ['agent_events', 'agent_runs', 'ai_usage']) assert.equal(fingerprints(store.db)[table], original[table], 'No new provider records or rewritten agent history.');
  assert.equal(writes.some(w => /agent-runs|agent-credentials|\/propose$/.test(w.path)), false, 'No new provider or synthetic agent action.');
  assert.deepEqual(pageErrors, []);
  const sourceEnd = sourceReceipt(), servedEnd = await servedBundleReceipt();
  const provenance = { sourceStart, sourceEnd, servedStart, servedEnd, unchangedSourceTree: sourceStart.treeSha256 === sourceEnd.treeSha256, unchangedServedBundle: servedStart.hash === servedEnd.hash };
  write('source-provenance.json', provenance);
  assert(provenance.unchangedSourceTree, 'Source changed during the workflow; keep as candidate evidence only.');
  assert(provenance.unchangedServedBundle, 'Served bundle changed during the workflow.');
  write('workflow-receipt.json', { status: 'succeeded', sourceCommit: sourceStart.commit, provenance: { sourceTreeSha256: sourceStart.treeSha256, dirty: sourceStart.dirty, servedBundleSha256: servedStart.hash, unchangedSourceTree: true, unchangedServedBundle: true }, originalSourceRowsUnchanged: true, originalSourceHashes: original, newProviderCalls: 0, costUsd: 0, lineage: 'Online backup of genuine completed proposal, matched studies and acceptance only in disposable copy.', comparison, acceptedRevision: 1, build, clip, videoProbe: probe, playback, pageErrors, writes, notesIsolation: { originalLocalPort: 4175, isolatedPort: notesPort, transport: 'Playwright WebSocket proxy before any Studio navigation' } });
  console.log(JSON.stringify({ status: 'succeeded', output, acceptedRevision: 1, buildId: build.id, clipId: clip.id, newProviderCalls: 0 }));
} finally {
  if (timer) clearInterval(timer);
  await browser.close(); await notes.destroy(); await app.close(); source.close();
}
