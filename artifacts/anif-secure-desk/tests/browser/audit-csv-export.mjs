// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runAuditCsvExportBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL
//
// All workspace and export requests are intercepted; no shared journal data is changed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspacePath = '/api/itsm';
const auditExportPath = '/api/itsm/audit/export';

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the audit CSV browser test.`);
  return value;
}

function appPath(baseURL, path) {
  const base = new URL(baseURL);
  const prefix = base.pathname.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin).href;
}

function watDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Libreville',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function makeAuditEvent(id, action, scope, at) {
  return { id, action, actor: 'Test navigateur', scope, at, time: '' };
}

/**
 * Verify that the visible journal filters are sent exactly once and the CSV
 * response is downloaded by the authenticated browser.
 */
export async function runAuditCsvExportBrowserTest({ signInClerkUser, newBrowserContext }) {
  if (typeof signInClerkUser !== 'function') {
    throw new TypeError('Pass the signInClerkUser helper from the Clerk E2E runner.');
  }
  if (typeof newBrowserContext !== 'function') {
    throw new TypeError('Pass the newBrowserContext helper from the Clerk E2E runner.');
  }

  const baseURL = requiredSetting('ANIF_BASE_URL');
  const n1Email = requiredSetting('ANIF_E2E_N1_EMAIL');
  const basePath = new URL(baseURL).pathname.replace(/\/+$/, '') || '/';
  const context = await newBrowserContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(baseURL);
    const fixture = await page.evaluate(async () => (await import('/src/lib/seed.ts')).migrate(null));
    const date = watDate();
    fixture.profile = { ...fixture.profile, clearance: 'N1 · Pilotage' };
    const matchingEvents = Array.from({ length: 123 }, (_, index) =>
      makeAuditEvent(`csv-match-${index + 1}`, `Export test authentifié ${index + 1}`, 'Messagerie', `${date}T11:00:00+01:00`));
    fixture.audit = [
      ...matchingEvents,
      makeAuditEvent('csv-other-action', 'Connexion sans rapport', 'Messagerie', `${date}T12:00:00+01:00`),
      makeAuditEvent('csv-other-scope', 'Export test autre périmètre', 'Tickets', `${date}T13:00:00+01:00`),
    ];
    const snapshot = { store: fixture, version: 1 };
    const exportRequests = [];
    const csv = `\uFEFFAction;Acteur;Périmètre\r\n${matchingEvents
      .map(event => `${event.action};Test navigateur;${event.scope}`)
      .join('\r\n')}\r\n`;

    await page.route(url => {
      try {
        return new URL(url).pathname === workspacePath || new URL(url).pathname === auditExportPath;
      } catch {
        return false;
      }
    }, async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === auditExportPath) {
        exportRequests.push({ method: request.method(), url: request.url() });
        return route.fulfill({
          status: 200,
          contentType: 'text/csv; charset=utf-8',
          headers: { 'content-disposition': 'attachment; filename="journal-test.csv"' },
          body: csv,
        });
      }
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
    await page.getByTestId('button-export-csv').waitFor({ state: 'visible' });

    assert.equal(await page.getByTestId('text-audit-count').innerText(), '(125 / 125)');
    assert.equal(await page.locator('[data-testid="text-audit-page-range"]').innerText(), 'Affichage de 1 à 50 sur 125 événements');
    assert.equal(await page.locator('[data-testid="button-audit-previous-page"]').isDisabled(), true);
    await page.getByTestId('button-audit-next-page').click();
    assert.equal(await page.getByTestId('text-audit-current-page').innerText(), 'Page 2 / 3');
    assert.equal(await page.locator('[data-testid="text-audit-page-range"]').innerText(), 'Affichage de 51 à 100 sur 125 événements');
    await page.getByTestId('button-audit-next-page').click();
    assert.equal(await page.getByTestId('text-audit-current-page').innerText(), 'Page 3 / 3');
    assert.equal(await page.locator('[data-testid="text-audit-page-range"]').innerText(), 'Affichage de 101 à 125 sur 125 événements');

    const query = 'Export test authentifié';
    await page.getByTestId('input-search-audit').fill(query);
    await page.getByTestId('filter-scope').selectOption('Messagerie');
    await page.getByTestId('input-date-from').fill(date);
    await page.getByTestId('input-date-to').fill(date);
    assert.equal(await page.getByTestId('text-audit-count').innerText(), '(123 / 125)');
    assert.equal(await page.getByTestId('text-audit-current-page').innerText(), 'Page 1 / 3');
    assert.equal(await page.locator('[data-testid="text-audit-page-range"]').innerText(), 'Affichage de 1 à 50 sur 123 événements');
    assert.equal(exportRequests.length, 0, 'Changing filters must not request an export.');

    const button = page.getByTestId('button-export-csv');
    assert.equal(await button.isDisabled(), false);
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    const download = await downloadPromise;

    assert.equal(exportRequests.length, 1, 'One click must trigger exactly one CSV request.');
    const request = exportRequests[0];
    assert.equal(request.method, 'GET');
    const requestUrl = new URL(request.url);
    assert.equal(requestUrl.pathname, auditExportPath);
    assert.deepEqual(
      Object.fromEntries(requestUrl.searchParams.entries()),
      { q: query, scope: 'Messagerie', from: date, to: date },
      'The CSV request must include exactly the visible filter values.',
    );

    const downloadedCsv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
    assert.equal(downloadedCsv, csv.replace(/^\uFEFF/, ''));
    assert.equal(downloadedCsv.trimEnd().split('\r\n').length, 124, 'The CSV must contain every filtered event, not only the visible page.');
    assert.match(downloadedCsv, /Export test authentifié 123;Test navigateur;Messagerie/);
    assert.match(
      download.suggestedFilename(),
      /^journal-anif-\d{4}-\d{2}-\d{2}\.csv$/,
      'The browser must receive the CSV download with the filename set by the journal.',
    );
    console.log('PASS: one filtered CSV request produced the expected browser download.');
  } finally {
    await context.close();
  }
}
