import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseURL = process.env.ANIF_BASE_URL?.trim();
if (!baseURL) throw new Error('Set ANIF_BASE_URL to run the mobile dialog scroll test.');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

try {
  await page.goto(baseURL);
  await page.evaluate(async () => {
    const { mountScrollRestoreDialog } = await import('/tests/browser/dialog-accessibility-harness.tsx');
    mountScrollRestoreDialog();
  });

  const opener = page.getByTestId('dialog-opener');
  const scrollRegion = page.getByTestId('scroll-region');
  await scrollRegion.evaluate(element => { element.scrollTop = 140; });
  await page.evaluate(() => window.scrollTo(0, 550));
  const expectedPosition = await page.evaluate(() => ({
    windowY: window.scrollY,
    regionY: document.querySelector('[data-testid="scroll-region"]').scrollTop,
  }));
  await opener.click();
  await page.getByTestId('dialog-input').waitFor({ state: 'visible' });

  await page.evaluate(async () => {
    const { setSimulatedKeyboardOpen } = await import('/tests/browser/dialog-accessibility-harness.tsx');
    setSimulatedKeyboardOpen(true);
  });
  await page.waitForTimeout(100);

  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'dialog-input',
    'The dialog input should own focus while the simulated mobile keyboard is open.');

  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForTimeout(350);

  const restoredPosition = await page.evaluate(() => ({
    windowY: window.scrollY,
    regionY: document.querySelector('[data-testid="scroll-region"]').scrollTop,
    focusedTestId: document.activeElement?.getAttribute('data-testid'),
  }));
  assert.equal(restoredPosition.windowY, expectedPosition.windowY,
    'Closing the dialog after the mobile viewport returns must restore page scroll.');
  assert.equal(restoredPosition.regionY, expectedPosition.regionY,
    'Closing the dialog must preserve the opener’s nested scroll context.');
  assert.equal(restoredPosition.focusedTestId, 'dialog-opener',
    'Focus must return to the action that opened the dialog.');

  console.log('PASS: mobile-sized viewport and simulated keyboard open/close restore page position and opener focus.');
} finally {
  await context.close();
  await browser.close();
}
