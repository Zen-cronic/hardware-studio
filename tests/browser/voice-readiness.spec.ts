import { openPrompt, studioTab } from './workspace-tools';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// SYNTHETIC UI contract tests only. No microphone, audio file, or cloud recognizer.
// Live speech recognition accuracy and OS permission behavior remain unverified.
async function installRecognizer(page: Page, mode = 'normal') {
  await page.addInitScript((mode) => {
    const w = window as any;
    const state = w.__syntheticVoice = { instances: [] as any[], stops: 0, aborts: 0 };
    class SyntheticRecognition {
      lang = ''; interimResults = true;
      onstart?: () => void; onend?: () => void; onerror?: (e: any) => void;
      onresult?: (e: any) => void;
      constructor() { state.instances.push(this); }
      start() {
        if (mode === 'throw') throw new DOMException('Synthetic start denied', 'NotAllowedError');
        if (mode !== 'delayed') this.onstart?.();
      }
      stop() { state.stops++; this.onend?.(); }
      abort() { state.aborts++; this.onend?.(); }
    }
    Object.defineProperty(w, 'SpeechRecognition', { configurable: true, value: mode === 'unsupported' ? undefined : SyntheticRecognition });
    Object.defineProperty(w, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  }, mode);
}
async function open(page: Page, request: APIRequestContext) {
  const r = await request.post('/api/designs', { data: { kind: 'turntable', name: 'Synthetic voice readiness fixture' } });
  expect(r.status()).toBe(201);
  const data = await r.json();
  await page.goto('/studio/' + data.snapshot.design.id + '#token=' + encodeURIComponent(data.access.editorToken));
  { await openPrompt(page); await expect(page.getByTestId('design-prompt')).toBeVisible(); }
  return data;
}
const speak = (page: Page) => page.getByRole('button', { name: 'Speak an instruction', exact: true });

test('SYNTHETIC: speech with nothing pointed at or selected sends a whole-design request without pressing Enter', async ({ page, request }) => {
  await installRecognizer(page);
  const d = await open(page, request);
  const sent: any[] = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/propose')) sent.push(r.postDataJSON()); });
  { await openPrompt(page); await page.getByTestId('design-prompt').fill('Keep the speed.'); }
  await speak(page).click();
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  const settings = await page.evaluate(() => {
    const r = (window as any).__syntheticVoice.instances[0];
    r.onspeechstart();
    const result: any = [{ transcript: 'Make the platter diameter 240 millimeters.' }]; result.isFinal = true;
    r.onresult({ results: [result] });
    r.onend();
    return { lang: r.lang, interimResults: r.interimResults };
  });
  expect(settings).toEqual({ lang: 'en-US', interimResults: false });
  await expect(page.getByRole('region', { name: 'Proposed change' })).toContainText('Platter diameter');
  await expect(page.getByTestId('design-prompt')).toHaveValue('Make the platter diameter 240 millimeters.');
  expect(sent).toHaveLength(1);
  expect(sent[0].prompt).toBe('Make the platter diameter 240 millimeters.');
  expect(sent[0].selection).toBeUndefined();
  // A proposal is only a preview: nothing changes until it is applied.
  const snap = await request.get('/api/designs/' + d.snapshot.design.id, { headers: { Authorization: 'Bearer ' + d.access.editorToken } });
  expect((await snap.json()).design.revision).toBe(0);
});

test('SYNTHETIC: stop ends listening and leaving the design panel aborts the recognizer', async ({ page, request }) => {
  await installRecognizer(page);
  await open(page, request);
  await speak(page).click();
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(speak(page)).toBeVisible();
  await speak(page).click();
  await studioTab(page, "Assemble");
  expect(await page.evaluate(() => ({ stops: (window as any).__syntheticVoice.stops, aborts: (window as any).__syntheticVoice.aborts }))).toEqual({ stops: 0, aborts: 2 });
});

test('SYNTHETIC: unsupported browser retains the typed draft and offers typing', async ({ page, request }) => {
  await installRecognizer(page, 'unsupported');
  await open(page, request);
  { await openPrompt(page); await page.getByTestId('design-prompt').fill('Keep this draft'); }
  await speak(page).click();
  await expect(page.getByRole('alert')).toContainText('Voice input is not supported');
  { await openPrompt(page); await expect(page.getByTestId('design-prompt')).toHaveValue('Keep this draft'); }
  { await openPrompt(page); await page.getByTestId('design-prompt').fill('Make the platter 240 mm wide.'); }
  await expect(page.getByTestId('propose-change')).toBeEnabled();
});

test('SYNTHETIC: asynchronous permission denial resets listening and retains typing', async ({ page, request }) => {
  await installRecognizer(page);
  await open(page, request);
  await speak(page).click();
  await page.evaluate(() => (window as any).__syntheticVoice.instances[0].onerror({ error: 'not-allowed' }));
  await expect(speak(page)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Microphone access was unavailable');
  { await openPrompt(page); await page.getByTestId('design-prompt').fill('Make the platter 240 mm wide.'); }
  await expect(page.getByTestId('propose-change')).toBeEnabled();
});

test('SYNTHETIC: synchronous start failure is caught with visible recovery', async ({ page, request }) => {
  await installRecognizer(page, 'throw');
  await open(page, request);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await speak(page).click();
  await expect(page.getByRole('alert')).toContainText('Microphone', { timeout: 1500 });
  expect(errors).toEqual([]);
});

test('SYNTHETIC: pending start prevents a second recognizer and orphan capture', async ({ page, request }) => {
  await installRecognizer(page, 'delayed');
  await open(page, request);
  await speak(page).click();
  await page.getByRole('button', { name: /Speak an instruction|Stop listening/ }).click();
  await studioTab(page, "Assemble");
  const state = await page.evaluate(() => ({ instances: (window as any).__syntheticVoice.instances.length, aborts: (window as any).__syntheticVoice.aborts, stops: (window as any).__syntheticVoice.stops }));
  expect(state.instances).toBe(1);
  expect(state.aborts + state.stops).toBe(state.instances);
});

for (const [code, message] of [
  ['no-speech', 'No speech was detected'],
  ['network', 'Speech recognition could not reach its service'],
  ['audio-capture', 'No microphone was available'],
]) test('SYNTHETIC: actionable recovery for ' + code, async ({ page, request }) => {
  await installRecognizer(page);
  await open(page, request);
  await speak(page).click();
  await page.evaluate(code => (window as any).__syntheticVoice.instances[0].onerror({ error: code }), code);
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(speak(page)).toBeVisible();
});

test('SYNTHETIC: a result from an ended session cannot alter the current draft', async ({ page, request }) => {
  await installRecognizer(page);
  await open(page, request);
  { await openPrompt(page); await page.getByTestId('design-prompt').fill('Preserve this draft'); }
  await speak(page).click();
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await page.evaluate(() => (window as any).__syntheticVoice.instances[0].onresult({ results: [[{ transcript: 'stale result' }]] }));
  { await openPrompt(page); await expect(page.getByTestId('design-prompt')).toHaveValue('Preserve this draft'); }
});
