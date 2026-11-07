import { openLoadSetup, openMeshSetup, openStudyHistory, openStudySetup } from './workspace-tools';
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { deskArmParts } from '../../src/shared/desk-arm';

test('maker reviews a real 0.5 kg component study and refines immutable inputs to convergence', async ({ page, request }, info) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const parts = deskArmParts().map(p => p.id === 'upper-arm' ? { ...p, size: [110, 6, 24] } : p);
  const created = await request.post('/api/designs', { data: { kind: 'custom', name: 'Component strength review', customParts: parts } });
  expect(created.status()).toBe(201);
  const { snapshot, access } = await created.json(), id = snapshot.design.id;
  const headers = { authorization: 'Bearer ' + access.editorToken };
  await page.goto(`/develop/${id}?part=upper-arm#token=${access.editorToken}`);
  const run = page.getByRole('button', { name: 'Run study', exact: true });
  const review = page.getByRole('checkbox', { name: /I reviewed this component/ });
  await expect(run).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Component', exact: true })).toHaveValue('upper-arm');
  { await openLoadSetup(page); await page.getByRole('spinbutton', { name: 'Test payload (kg)', exact: true }).fill('0.5'); }
  await page.getByRole('combobox', { name: 'Fixed end', exact: true }).selectOption('max');
  await expect(page.getByRole('alert')).toContainText('must be different faces');
  await expect(run).toBeDisabled();
  await page.getByRole('combobox', { name: 'Loaded end', exact: true }).selectOption('min');
  await page.getByRole('combobox', { name: 'Force direction', exact: true }).selectOption('+z');
  await expect(page.getByRole('img', { name: /Upper arm link: fixed/ })).toHaveAttribute('aria-label', 'Upper arm link: fixed +X end, loaded −X end, force Local +Z');
  await review.check(); await expect(run).toBeEnabled();
  await page.getByRole('combobox', { name: 'Fixed end', exact: true }).selectOption('min');
  await page.getByRole('combobox', { name: 'Loaded end', exact: true }).selectOption('max');
  await page.getByRole('combobox', { name: 'Force direction', exact: true }).selectOption('-y');
  await expect(review).not.toBeChecked();
  { await openMeshSetup(page); await page.getByRole('spinbutton', { name: 'Starting mesh size (mm)', exact: true }).fill('8'); }
  await review.check();
  await page.locator('.strength-preview').screenshot({ path: info.outputPath('component-local-review.png') });
  const submitted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/designs/${id}/studies`));
  await run.click(); const firstResponse = await submitted; expect(firstResponse.status()).toBe(202);
  const first = await firstResponse.json();
  expect(first.setup.supports).toEqual([{ axis: 'x', side: 'min' }]);
  expect(first.setup.loads).toEqual([{ axis: 'x', side: 'max', forceN: [0, -4.903325, 0] }]);
  expect(first.setup.mesh).toEqual({ maxSizeMm: 8, refinements: 2 });
  await expect(page.getByRole('heading', { name: 'More mesh refinement needed', exact: true })).toBeVisible({ timeout: 90000 });
  await page.locator('.study-result').screenshot({ path: info.outputPath('unconverged-result.png') });
  // The current form must never silently replace the inputs used for this result.
  { await openLoadSetup(page); await page.getByRole('spinbutton', { name: 'Test payload (kg)', exact: true }).fill('10'); }
  await page.getByRole('combobox', { name: 'Force direction', exact: true }).selectOption('+x');
  { await openMeshSetup(page); await page.getByRole('spinbutton', { name: 'Starting mesh size (mm)', exact: true }).fill('12'); }
  const refinedResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/api/designs/${id}/studies`));
  await page.getByRole('button', { name: 'Refine and rerun', exact: true }).click();
  const secondResponse = await refinedResponse; expect(secondResponse.status()).toBe(202);
  const second = await secondResponse.json();
  expect(second.revision).toBe(first.revision);
  expect(second.snapshotHash).toBe(first.snapshotHash);
  expect(second.setup).toEqual({ ...first.setup, mesh: { maxSizeMm: 4, refinements: 2 } });
  await expect(page.getByRole('heading', { name: 'Mesh convergence passed', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.locator('.analysis-viewport')).toBeVisible();
  await expect(page.locator('.development-scene > .model-canvas')).toHaveCount(0);
  await expect(page.locator('.study-setup')).not.toHaveAttribute('open');
  await openStudySetup(page);
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('lower-arm');
  await expect(page.locator('.development-scene > .model-canvas')).toBeVisible();
  await expect(page.locator('.analysis-viewport')).toHaveCount(0);
  await expect(page.locator('.study-result')).toContainText('Result for Upper arm link');
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('upper-arm');
  await page.getByRole('button', { name: 'Study result', exact: true }).click();
  const actual = await (await request.get('/api/studies/' + second.id, { headers })).json();
  expect(actual.result.convergence.status).toBe('converged');
  expect(actual.result.appliedForceN).toEqual([0, -4.903325, 0]);
  expect(actual.result.convergence.levels.map((l: any) => l.maxSizeMm)).toEqual([4, 2.8, 1.9599999999999997]);
  await page.locator('.study-result').screenshot({ path: info.outputPath('converged-result.png') });
  await page.screenshot({ path: info.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  { await openLoadSetup(page); await page.getByRole('spinbutton', { name: 'Test payload (kg)', exact: true }).fill('0.5'); }
  await page.getByRole('combobox', { name: 'Force direction', exact: true }).selectOption('-y');
  { await openMeshSetup(page); await page.getByRole('spinbutton', { name: 'Starting mesh size (mm)', exact: true }).fill('4'); }
  await page.locator('.strength-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('mobile-setup.png') });
  await page.locator('.study-result').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('mobile-result.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Existing recorded study remains viewable but cannot be reused after a design edit.
  { await openStudyHistory(page); await page.getByRole('combobox', { name: 'View result', exact: true }).selectOption(first.id); }
  const edit = await request.post(`/api/designs/${id}/commands`, { headers, data: {
    id: 'strength-stale-fixture', actor: 'Browser check', baseRevision: 0, changes: {}, readSet: snapshot.design.params,
    customParts: parts.map(p => p.id === 'upper-arm' ? { ...p, size: [110, 7, 24] } : p),
  } });
  expect(edit.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Refine and rerun', exact: true })).toBeDisabled({ timeout: 10000 });
  await expect(page.getByText('The design changed. Review a new study on the current revision.')).toBeVisible();
  await expect(page.locator('.development-scene-heading')).toContainText('r0');
  await expect(page.locator('.development-scene-heading')).toContainText('Upper arm link');
  await page.goto(`/develop/${id}?part=upper-arm#token=${access.viewerToken}`);
  await openStudySetup(page);
  await expect(page.getByRole('button', { name: 'Run study', exact: true })).toBeDisabled();
  { await openStudyHistory(page); await page.getByRole('combobox', { name: 'View result', exact: true }).selectOption(first.id); }
  await expect(page.getByRole('button', { name: 'Refine and rerun', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
  writeFileSync(info.outputPath('proof.json'), JSON.stringify({ fixture: 'disposable synthetic camera-arm component, 110 × 6 × 24 mm with two 6.4 mm holes', first: { id: first.id, revision: first.revision, setup: first.setup }, refined: { id: second.id, revision: second.revision, setup: second.setup, convergence: actual.result.convergence, appliedForceN: actual.result.appliedForceN, maxDisplacementMm: actual.result.maxDisplacementMm }, browserErrors: errors, width: 375, overflow: false, staleBlocked: true, viewerBlocked: true }, null, 2));
});
