import { test, expect, type Page } from '@playwright/test';

// The turntable section is one screen tall below the prompt hero; its chapter buttons choose the view.
async function advance(page: Page, progress: number) {
  await page.locator('.landing-story').evaluate(story => {
    window.scrollTo({ top: window.scrollY + story.getBoundingClientRect().top, behavior: 'instant' });
  });
  if (progress <= 0.05) {
    const first = page.getByRole('button', { name: 'See it work', exact: true });
    if (await first.isVisible()) await first.click();
    return;
  }
  await page.getByRole('button', { name: progress > 0.6 ? 'Change the size' : 'Look inside', exact: true }).click();
}

async function ready(page: Page) {
  await page.goto('/');
  // The turntable section sits below the prompt hero and the walkthrough; bring it into view first.
  await page.locator('.landing-story').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready);
}

test('chapter controls keep the same scene while parts and real dimensions change, then reverse', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
  await ready(page);
  const scene = page.getByTestId('landing-scene');
  const canvas = page.locator('.landing-hero canvas');
  const sameCanvas = await canvas.elementHandle();
  await expect(scene).toHaveAttribute('data-diameter', '220');
  await advance(page, .20);
  await expect.poll(async () => Number(await scene.getAttribute('data-scroll'))).toBeGreaterThan(.15);
  await page.waitForTimeout(1400);
  const parts = await canvas.screenshot();
  const separation = Number(await canvas.getAttribute('data-assembly-amount'));
  expect(separation).toBeGreaterThan(.5);
  await advance(page, .99);
  await expect(scene).toHaveAttribute('data-diameter', '280');
  await page.waitForTimeout(1400);
  expect((await canvas.screenshot()).equals(parts)).toBe(false);
  expect(await sameCanvas!.evaluate(el => el === document.querySelector('.landing-hero canvas'))).toBe(true);
  await advance(page, 0);
  await expect(scene).toHaveAttribute('data-diameter', '220');
  await expect.poll(async () => Number(await scene.getAttribute('data-scroll'))).toBeLessThan(.05);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test('movement continues after the entrance and stops offscreen and on pause', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('.landing-hero canvas');
  const scene = page.getByTestId('landing-scene');
  await page.waitForTimeout(11000);
  const clockStart=await canvas.evaluate(el=>({wall:performance.now(),simulation:Number(el.dataset.elapsed)}));
  await page.waitForTimeout(2500);
  const clockEnd=await canvas.evaluate(el=>({wall:performance.now(),simulation:Number(el.dataset.elapsed)}));
  const elapsedRatio=(clockEnd.simulation-clockStart.simulation)/((clockEnd.wall-clockStart.wall)/1000);
  expect(elapsedRatio).toBeGreaterThan(.55);
  expect(elapsedRatio).toBeLessThan(1.45);
  const moving = await canvas.screenshot();
  await page.waitForTimeout(1200);
  expect((await canvas.screenshot()).equals(moving)).toBe(false);
  await page.getByTestId('landing-motion-toggle').click();
  await expect(scene).toHaveAttribute('data-motion', 'paused');
  await page.waitForTimeout(500);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(1000);
  expect((await canvas.screenshot()).equals(paused)).toBe(true);
  await page.getByTestId('landing-motion-toggle').click();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(scene).toHaveAttribute('data-motion', 'paused');
  // The page now has other 3D views; let the last requested frame land before counting.
  await expect.poll(async () => { const a = await canvas.getAttribute('data-render-count'); await page.waitForTimeout(400); return a === await canvas.getAttribute('data-render-count'); }).toBe(true);
  const count = await canvas.getAttribute('data-render-count');
  await page.waitForTimeout(900);
  expect(await canvas.getAttribute('data-render-count')).toBe(count);
  await advance(page, 0);
  await expect(scene).toHaveAttribute('data-motion', 'playing');
});

test('reduced motion keeps a static scene while keyboard controls preserve both sizes and assembly', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:375,height:812});
  await ready(page);
  const scene=page.getByTestId('landing-scene');
  const canvas=page.locator('.landing-hero canvas');
  await expect(page.getByTestId('landing-motion-toggle')).toBeDisabled();
  await expect(scene).toHaveAttribute('data-diameter','220');
  const first=await canvas.screenshot();
  const wider=page.getByTestId('landing-size-280');
  await wider.focus(); await page.keyboard.press('Enter');
  await expect(scene).toHaveAttribute('data-diameter','280');
  await expect(wider).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.landing-spec')).toContainText('218.4 mm base');
  await page.waitForTimeout(300);
  const wide=await canvas.screenshot();
  expect(wide.equals(first)).toBe(false);
  await page.waitForTimeout(900);
  expect((await canvas.screenshot()).equals(wide)).toBe(true);
  const assembly=page.getByTestId('landing-assembly-toggle');
  await assembly.focus(); await page.keyboard.press('Enter');
  await expect(assembly).toHaveAccessibleName('Show assembled');
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(wide)).toBe(false);
  await page.getByTestId('landing-size-220').click();
  await expect(scene).toHaveAttribute('data-diameter','220');
  await expect(page.locator('.landing-spec')).toContainText('171.6 mm base');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const id of ['landing-size-220','landing-size-280']){
    const box=await page.getByTestId(id).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(375);
  }
});

test('the build sheet follows the chosen dimensions and all six previews open real designs', async ({ page }) => {
  // Six round trips through a home page that now carries three 3D views.
  test.setTimeout(180000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const writes:string[]=[];
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname)});
  await ready(page);
  await page.getByTestId('landing-size-280').click();
  await expect(page.locator('.landing-build-sheet tr').filter({hasText:'Rotating platter'})).toContainText('280');
  await expect(page.locator('.landing-build-sheet tr').filter({hasText:'Base plate'})).toContainText('218.4');
  await expect(page.locator('.landing-example')).toHaveCount(6);
  for(const kind of ['turntable','slider','conveyor','lamp','planter','holder']){
    const preview=page.locator(`.landing-example:has(img[src="/previews/${kind}.png"])`);
    await preview.scrollIntoViewIfNeeded();
    await expect.poll(()=>preview.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    await preview.click();
    await expect(page).toHaveURL(new RegExp('/designs/'+kind+'$'));
    await expect(page.getByTestId('customize-design')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.landing-example')).toHaveCount(6);
  }
  expect(writes).toEqual([]);
});


test('paused assembly controls reach both complete states from an automatic separation', async ({ page }) => {
  await ready(page);
  const canvas=page.locator('.landing-hero canvas');
  await advance(page,.20);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-assembly-amount'))).toBeGreaterThan(.8);
  await page.getByTestId('landing-motion-toggle').click();
  const assembly=page.getByTestId('landing-assembly-toggle');
  await expect(assembly).toHaveAccessibleName('Show assembled');
  await assembly.click();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-assembly-amount'))).toBe(0);
  const assembled=await canvas.screenshot();
  await expect(assembly).toHaveAccessibleName('Show parts');
  await assembly.click();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-assembly-amount'))).toBe(1);
  const separated=await canvas.screenshot();
  expect(separated.equals(assembled)).toBe(false);
  await page.waitForTimeout(600);
  expect((await canvas.screenshot()).equals(separated)).toBe(true);
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-motion','paused');
});

test('visibility changes suspend the animation clock and resume without hidden time', async ({ page }) => {
  await ready(page);
  const canvas=page.locator('.landing-hero canvas');
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-motion','paused');
  await page.waitForTimeout(300);
  const elapsed=Number(await canvas.getAttribute('data-elapsed'));
  const frozen=await canvas.screenshot();
  await page.waitForTimeout(1500);
  expect((await canvas.screenshot()).equals(frozen)).toBe(true);
  expect(Number(await canvas.getAttribute('data-elapsed'))).toBe(elapsed);
  await page.evaluate(()=>{
    delete (document as unknown as {hidden?:boolean}).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('landing-scene')).toHaveAttribute('data-motion','playing');
  await page.waitForTimeout(400);
  const resumed=Number(await canvas.getAttribute('data-elapsed'));
  expect(resumed).toBeGreaterThan(elapsed);
  expect(resumed-elapsed).toBeLessThan(1.5);
});
