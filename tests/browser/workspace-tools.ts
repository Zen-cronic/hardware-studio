import { expect, type Page } from '@playwright/test';

export async function openDimensions(page: Page) {
  await page.locator('#studio-right-panel').waitFor({ state: 'attached' });
  if ((page.viewportSize()?.width || 1440) <= 820) {
    await page.getByRole('button', { name: 'Dimensions', exact: true }).click();
  } else {
    const open = page.getByRole('button', { name: 'Expand right panel', exact: true });
    if (await open.count()) await open.click();
  }
  await expect(page.locator('.right-panel')).toBeVisible();
}

export async function openPrompt(page: Page) {
  await page.locator('#studio-left-panel').waitFor({ state: 'attached' });
  if ((page.viewportSize()?.width || 1440) <= 820) {
    await page.locator('.mobile-editor-switch').getByRole('button', { name: 'Describe a change', exact: true }).click();
  } else {
    const open = page.getByRole('button', { name: 'Expand left panel', exact: true });
    if (await open.count()) await open.click();
  }
  const request = page.locator('.inspector-tabs').getByRole('button', { name: 'Write a request', exact: true });
  if (await request.isVisible()) await request.click();
  await expect(page.getByTestId('design-prompt')).toBeVisible();
}

export async function closePanels(page: Page) {
  for (const side of ['left', 'right']) {
    const button = page.getByRole('button', { name: `Collapse ${side} panel`, exact: true });
    if (await button.isVisible()) await button.click();
  }
}

export async function openStudySetup(page: Page) {
  const setup = page.locator(".study-setup");
  if (await setup.count() && await setup.getAttribute("open") === null) {
    await setup.locator(":scope > summary").click();
  }
}

async function disclosure(page: Page, name: string) {
  if (name !== "Study history and comparison") await openStudySetup(page);
  const summary = page.locator('summary').filter({ hasText: new RegExp('^' + name + '$') });
  await summary.waitFor({ state: 'visible' });
  if (await summary.locator('..').getAttribute('open') === null) await summary.click();
}

export const openLoadSetup = (page: Page) => disclosure(page, 'Review loads and supports');
export const openMeshSetup = (page: Page) => disclosure(page, 'Mesh accuracy');
export const openStudyHistory = (page: Page) => disclosure(page, 'Study history and comparison');
