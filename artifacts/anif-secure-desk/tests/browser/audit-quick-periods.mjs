// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runAuditQuickPeriodsBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL
//
// The workspace API is intercepted and receives only an in-memory fixture.
// The test does not change shared journal data.
import assert from 'node:assert/strict';

const workspacePath = '/api/itsm';
const expectedButtons = [
  { id: 'button-audit-today', label: 'Aujourd’hui', eventIds: ['today'] },
  { id: 'button-audit-yesterday', label: 'Hier', eventIds: ['yesterday'] },
  { id: 'button-audit-last-7-days', label: '7 derniers jours', eventIds: ['today', 'yesterday', 'six-days-ago'] },
  { id: 'button-audit-last-30-days', label: '30 derniers jours', eventIds: ['today', 'yesterday', 'six-days-ago', 'twenty-nine-days-ago'] },
];

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the audit quick-period browser test.`);
  return value;
}

function appPath(baseURL, path) {
  const base = new URL(baseURL);
  const prefix = base.pathname.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin).href;
}

function watDayOffset(offset, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Libreville',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type)?.value ?? '';
  const day = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

function makeAuditEvent(id, day) {
  return {
    id,
    action: `Événement de test ${id}`,
    actor: 'Test navigateur',
    scope: 'Contrôle des périodes',
    time: '',
    // 11:00 UTC is noon in Libreville (WAT, UTC+1).
    at: new Date(`${day}T12:00:00+01:00`).toISOString(),
  };
}

/**
 * Check every recent-period button using Tab and Enter in an authenticated
 * browser, asserting the WAT date fields and visible events after activation.
 */
export async function runAuditQuickPeriodsBrowserTest({ signInClerkUser, newBrowserContext }) {
  if (typeof signInClerkUser !== 'function') {
    throw new TypeError('Pass the signInClerkUser helper from the Clerk E2E runner.');
  }
  if (typeof newBrowserContext !== 'function') {
    throw new TypeError('Pass the newBrowserContext helper from the Clerk E2E runner.');
  }

  const baseURL = requiredSetting('ANIF_BASE_URL');
  const n1Email = requiredSetting('ANIF_E2E_N1_EMAIL');
  const basePath = new URL(baseURL).pathname.replace(/\/+$/, '') || '/';
  const context = await newBrowserContext({});
  const page = await context.newPage();

  try {
    await page.goto(baseURL);
    const fixture = await page.evaluate(async () => (await import('/src/lib/seed.ts')).migrate(null));
    const now = new Date();
    const offsets = [
      ['today', 0],
      ['yesterday', 1],
      ['six-days-ago', 6],
      ['twenty-nine-days-ago', 29],
      ['thirty-one-days-ago', 31],
    ];
    fixture.profile = { ...fixture.profile, clearance: 'N1 · Pilotage' };
    fixture.audit = offsets.map(([id, offset]) => makeAuditEvent(id, watDayOffset(offset, now)));
    const snapshot = { store: fixture, version: 1 };
    let writeRequests = 0;

    await page.route(url => {
      try {
        return new URL(url).pathname === workspacePath;
      } catch {
        return false;
      }
    }, async route => {
      if (route.request().method() === 'PUT') writeRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshot),
      });
    });

    const signInUrl = await signInClerkUser({
      firstName: 'ANIF',
      lastName: 'Test',
      email: n1Email,
      basePath,
    });
    await page.goto(signInUrl);
    await page.goto(appPath(baseURL, '/audit'));
    const group = page.getByRole('group', { name: 'Périodes récentes du journal' });
    await group.waitFor({ state: 'visible' });

    for (const { id, label } of expectedButtons) {
      const button = page.getByTestId(id);
      assert.equal(await button.getAttribute('type'), 'button', `${label} must not submit a form.`);
      assert.equal(await button.getAttribute('aria-label'), null, `${label} must use its visible accessible name.`);
      assert.equal(await button.innerText(), label, `${label} must remain understandable to assistive technology.`);
      assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1,
        `${label} must expose its visible text as its accessible name.`);
    }
    const fromInput = page.getByLabel('Du (WAT)');
    const toInput = page.getByLabel('Au (WAT)');
    assert.equal(await fromInput.getAttribute('type'), 'date');
    assert.equal(await toInput.getAttribute('type'), 'date');
    const resultStatus = page.getByTestId('text-audit-count');
    assert.equal(await resultStatus.getAttribute('role'), 'status');
    assert.equal(await resultStatus.getAttribute('aria-live'), 'polite');
    assert.equal(await resultStatus.getAttribute('aria-atomic'), 'true');

    const visited = [];
    let focusedButtonIndex = 0;
    for (let tabCount = 0; tabCount < 100 && visited.length < expectedButtons.length; tabCount += 1) {
      await page.keyboard.press('Tab');
      const activeTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
      const index = expectedButtons.findIndex(item => item.id === activeTestId);
      if (index < 0) continue;

      assert.equal(index, focusedButtonIndex, 'Quick-period buttons must be reachable in their displayed order.');
      const { id, label, eventIds } = expectedButtons[index];
      const button = page.getByTestId(id);
      assert.equal(await button.evaluate(element => element === document.activeElement), true,
        `${label} must receive keyboard focus.`);
      assert.notEqual(
        await button.evaluate(element => getComputedStyle(element).outlineStyle),
        'none',
        `${label} must have a visible keyboard focus indicator.`,
      );
      await page.keyboard.press('Enter');

      const expectedRange = index < 2
        ? { from: watDayOffset(index, now), to: watDayOffset(index, now) }
        : { from: watDayOffset(index === 2 ? 6 : 29, now), to: watDayOffset(0, now) };
      await page.waitForFunction(([from, to]) => {
        const fromInput = document.querySelector('[data-testid="input-date-from"]');
        const toInput = document.querySelector('[data-testid="input-date-to"]');
        return fromInput?.value === from && toInput?.value === to;
      }, [expectedRange.from, expectedRange.to]);
      assert.equal(await fromInput.inputValue(), expectedRange.from, `${label} must set the start date in WAT.`);
      assert.equal(await toInput.inputValue(), expectedRange.to, `${label} must set the end date in WAT.`);

      const visibleEvents = await page.locator('time[datetime]').evaluateAll(nodes =>
        nodes.map(node => node.parentElement?.querySelector('.font-semibold')?.textContent ?? ''),
      );
      assert.deepEqual(
        visibleEvents,
        eventIds.map(id => `Événement de test ${id}`),
        `${label} must show only the events in the selected period.`,
      );
      assert.equal(
        await resultStatus.innerText(),
        `(${eventIds.length} / 5)`,
        `${label} must update the visible result count.`,
      );
      visited.push(label);
      focusedButtonIndex += 1;
    }

    assert.deepEqual(visited, expectedButtons.map(item => item.label),
      'All quick-period shortcuts must be keyboard reachable and activatable.');
    assert.equal(writeRequests, 0, 'Changing filters must not save or mutate the workspace.');
  } finally {
    await context.close();
  }
}
