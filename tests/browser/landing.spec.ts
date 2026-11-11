import { test, expect } from '@playwright/test';

test('landing leads into a separate searchable catalog and preserves navigation', async ({ page }) => {
  const writes: string[] = [], errors: string[] = [];
  page.on('request', r => { if (!['GET','HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.landing-page h1')).toHaveCount(1);
  await expect(page.locator('.landing-page h1')).toHaveText('Make anything from scratch.');
  await expect(page.locator('.lp-sub')).toHaveText(/^Point at any part and say what to change\. Hardware Studio redesigns it in 3D/);
  await expect(page.locator('.collection')).toHaveCount(0);
  await page.getByTestId('landing-browse').click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator('.product-card')).toHaveCount(8);
  await page.reload();
  await expect(page.locator('.product-card')).toHaveCount(8);
  await page.getByRole('button', {name:'Growing', exact:true}).click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.getByTestId('product-planter')).toBeVisible();
  await page.getByRole('button', {name:'All designs', exact:true}).click();
  await page.getByRole('textbox', {name:'Find a design'}).fill('turntable');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('button', {name:'Explore Motorized turntable', exact:true}).click();
  await expect(page).toHaveURL(/\/designs\/turntable$/);
  await expect(page.getByTestId('customize-design')).toBeVisible();
  await page.getByRole('button', {name:'All designs', exact:true}).click();
  await expect(page).toHaveURL(/\/browse$/);
  await page.getByRole('button', {name:'Hardware Studio home'}).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('landing-try').click();
  await expect(page).toHaveURL(/\/designs\/turntable$/);
  await page.goBack();
  await expect(page.locator('.landing-page')).toBeVisible();
  await page.reload();
  await expect(page.locator('.landing-page')).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('assembly animation changes actual frames, pauses, and supports keyboard inspection', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('.landing-hero canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>document.fonts.ready);
  const toggle = page.getByTestId('landing-motion-toggle');
  await expect(toggle).toHaveAccessibleName('Pause animation');
  await page.waitForTimeout(1200);
  const moving = await canvas.screenshot();
  await page.waitForTimeout(1100);
  expect((await canvas.screenshot()).equals(moving)).toBe(false);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('Play animation');
  await page.waitForTimeout(600);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(800);
  expect((await canvas.screenshot()).equals(paused)).toBe(true);
  const assembly = page.getByTestId('landing-assembly-toggle');
  await assembly.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1300);
  expect((await canvas.screenshot()).equals(paused)).toBe(false);
});

test('reduced motion stays still and controls fit small screens', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  for (const width of [320,375,768,1440]) {
    await page.setViewportSize({width,height:width===1440?900:812});
    await page.goto('/');
    const canvas=page.locator('.landing-hero canvas');
    await expect(canvas).toBeVisible();
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(800);
    const first=await canvas.screenshot();
    await page.waitForTimeout(800);
    expect((await canvas.screenshot()).equals(first)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for (const id of ['landing-motion-toggle','landing-assembly-toggle','landing-browse','landing-try','landing-size-220','landing-size-280']) {
      const box=await page.getByTestId(id).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    }
    const spec=await page.locator('.landing-spec').boundingBox();
    const actions=await page.locator('.landing-copy .landing-actions').boundingBox();
    expect(spec!.y).toBeGreaterThanOrEqual(actions!.y+actions!.height);
  }
});

test('landing remains usable without WebGL', async ({ page }) => {
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){
      if (/webgl/i.test(type)) return null;
      return original.apply(this,[type,...args] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByRole('region',{name:'3D preview unavailable'})).toBeVisible();
  await expect(page.locator('.landing-loading')).toHaveCount(0);
  await expect(page.locator('.landing-page h1')).toBeVisible();
  await page.getByTestId('landing-browse').click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator('.product-card')).toHaveCount(8);
});

 test('unavailable design recovery goes straight to browsing', async ({page})=>{
  await page.goto('/studio/missing#token=invalid');
  await page.getByRole('button',{name:'Back to designs',exact:true}).click();
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.locator('.product-card')).toHaveCount(8);
});
