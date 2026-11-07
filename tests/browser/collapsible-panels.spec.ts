import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { openDimensions, openPrompt, closePanels } from './workspace-tools';

async function openDesign(page: Page, request: APIRequestContext) {
  const response = await request.post('/api/designs', {
    data: { kind: 'turntable', name: 'Adjustable turntable' },
  });
  expect(response.status()).toBe(201);
  const result = await response.json();
  await page.goto(`/studio/${result.snapshot.design.id}#token=${encodeURIComponent(result.access.editorToken)}`);
  await expect(page.locator('.scene-panel .model-canvas')).toHaveAttribute('data-ready', 'true');
}

const sceneWidth = async (page: Page) => (await page.locator('.scene-panel').boundingBox())!.width;
async function settleCanvas(page: Page) {
  await expect.poll(() => page.locator('.scene-panel canvas').evaluate((canvas: HTMLCanvasElement) =>
    Math.abs(canvas.width - canvas.getBoundingClientRect().width * devicePixelRatio),
  )).toBeLessThan(2);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const viewport of [1440, 900]) {
  test(`one panel at a time preserves both drafts at ${viewport}px`, async ({ page, request }) => {
    await page.setViewportSize({ width: viewport, height: 1000 });
    await openDesign(page, request);
    await expect(page.locator('.left-panel')).toBeHidden();
    await expect(page.locator('.right-panel')).toBeHidden();
    const full = await sceneWidth(page);
    const left = page.getByRole('button', { name: 'Expand left panel', exact: true });
    await left.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('design-prompt').fill('Add a wider base for the camera.');
    await settleCanvas(page);
    expect(await sceneWidth(page)).toBeLessThan(full - 250);
    const right = page.getByRole('button', { name: 'Expand right panel', exact: true });
    await right.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.left-panel')).toBeHidden();
    await page.getByTestId('param-diameter').fill('280');
    await settleCanvas(page);
    await page.getByTestId('param-diameter').press('Escape');
    await expect(page.locator('.right-panel')).toBeHidden();
    await expect(right).toBeFocused();
    await settleCanvas(page);
    expect(await sceneWidth(page)).toBeCloseTo(full, 0);
    await openPrompt(page);
    await expect(page.getByTestId('design-prompt')).toHaveValue('Add a wider base for the camera.');
    await openDimensions(page);
    await expect(page.getByTestId('param-diameter')).toHaveValue('280');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('phone starts with the model and exposes one task with visible focus restoration', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openDesign(page, request);
  await expect(page.getByTestId('design-prompt')).toBeHidden();
  await expect(page.getByTestId('param-diameter')).toBeHidden();
  for (const width of [375, 320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await openDimensions(page);
    await page.getByTestId('param-diameter').fill('280');
    await page.getByTestId('param-diameter').press('Escape');
    await expect(page.getByRole('button', { name: 'Dimensions', exact: true })).toBeFocused();
    await expect(page.getByTestId('param-diameter')).toBeHidden();
    await openPrompt(page);
    await page.getByRole('button', { name: 'Draw a sketch', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('design-prompt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draw a sketch', exact: true })).toBeFocused();
    await page.getByTestId('design-prompt').press('Escape');
    await expect(page.getByRole('button', { name: 'Describe a change', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Open shared notes', exact: true }).click();
    await expect(page.locator('.notes-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Close shared notes', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.notes-drawer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open shared notes', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Model', exact: true }).click();
    await settleCanvas(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('assembly and build open actionable panels and let the model reclaim space', async ({ page, request }) => {
  await openDesign(page, request);
  for (const name of ['Assemble', 'Build']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.locator('.right-panel')).toBeVisible();
    await expect(page.locator('.left-panel')).toBeHidden();
    await closePanels(page);
    await expect(page.locator('.right-panel')).toBeHidden();
    await page.getByRole('button', { name: 'Expand left panel', exact: true }).click();
    await expect(page.locator('.left-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Expand right panel', exact: true }).click();
    await expect(page.locator('.left-panel')).toBeHidden();
    await expect(page.locator('.right-panel')).toBeVisible();
  }
});
