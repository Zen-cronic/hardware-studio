import { test, expect } from '@playwright/test';

test('guide comparison updates connected dimensions without saving a design', async ({ page }) => {
  const mutations: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.method());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/judge');
  const example = page.getByTestId('guide-dimension-preview');
  const canvas = example.locator('canvas');
  await expect(example.locator('.model-canvas')).toHaveAttribute('data-ready', 'true');
  const element = await canvas.elementHandle();
  await expect(page.getByTestId('guide-platter-diameter')).toContainText('220');
  await expect(page.getByTestId('guide-base-diameter')).toContainText('171.6');
  await expect(page.getByTestId('guide-bom-spec')).toContainText('171.6');
  const before = await canvas.screenshot();
  const wider = example.getByRole('button', { name: '280 mm', exact: true });
  await wider.focus();
  await page.keyboard.press('Enter');
  await expect(wider).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('guide-platter-diameter')).toContainText('280');
  await expect(page.getByTestId('guide-base-diameter')).toContainText('218.4');
  await expect(page.getByTestId('guide-bom-spec')).toContainText('218.4');
  expect(await element!.evaluate(node => node === document.querySelector('[data-testid="guide-dimension-preview"] canvas'))).toBe(true);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await expect(example.locator('.guide-fixed-values')).toHaveText('Unchanged: 180 mm height, 8 mm shaft, 6 rpm.');
  const viewBefore = await canvas.getAttribute('data-view');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 45, bounds!.y + bounds!.height / 2 + 15, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-view', viewBefore!);
  await expect(page.getByTestId('guide-base-diameter')).toContainText('218.4');
  await example.getByRole('button', { name: '220 mm', exact: true }).click();
  await expect(page.getByTestId('guide-base-diameter')).toContainText('171.6');
  await expect(page.getByTestId('guide-bom-spec')).toContainText('171.6');
  await expect(page.locator('.judge-steps > div')).toHaveCount(5);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});

test('guide controls and navigation remain usable at phone and desktop sizes', async ({ page }) => {
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
    await page.goto('/judge');
    await expect(page.getByTestId('guide-dimension-preview')).toBeVisible();
    await page.getByRole('button', { name: '280 mm', exact: true }).click();
    await expect(page.getByTestId('guide-base-diameter')).toContainText('218.4');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ['220 mm', '280 mm']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  }
  await page.getByRole('button', { name: 'Begin with the turntable', exact: true }).click();
  await expect(page).toHaveURL(/\/designs\/turntable$/);
  await expect(page.getByRole('heading', { name: 'Motorized turntable', exact: true })).toBeVisible();
  await page.goto('/judge');
  await page.getByRole('button', { name: 'Try a new design', exact: true }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test('guide dimensions stay available when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto('/judge');
  await expect(page.getByRole('region', { name: '3D preview unavailable' })).toBeVisible();
  await page.getByRole('button', { name: '280 mm', exact: true }).click();
  await expect(page.getByTestId('guide-base-diameter')).toContainText('218.4');
  await expect(page.getByTestId('guide-bom-spec')).toContainText('218.4');
});
