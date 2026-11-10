// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runAuditTicketAccessBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL
//
// The workspace API is intercepted with role-scoped in-memory fixtures.
// No shared tickets or journal events are changed.
import assert from 'node:assert/strict';

const workspacePath = '/api/itsm';
const inScopeTicketId = 'INC-ACCESS-IN-SCOPE';
const outOfScopeTicketId = 'INC-ACCESS-OUT-OF-SCOPE';
const closedTicketId = 'INC-ACCESS-CLOSED';
const inScopeTitle = 'Ticket accessible · titre de test';
const outOfScopeTitle = 'Ticket confidentiel hors périmètre · titre de test';
const closedTicketTitle = 'Ticket clos accessible · titre de test';
const outOfScopeDescription = 'Description confidentielle hors périmètre unique e2e.';

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the audit ticket-access browser test.`);
  return value;
}

function appPath(baseURL, path) {
  const base = new URL(baseURL);
  const prefix = base.pathname.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin).href;
}

/**
 * Verify that audit links follow the current workspace ticket scope and that a
 * direct URL cannot reveal a ticket excluded from that scoped workspace.
 */
export async function runAuditTicketAccessBrowserTest({ signInClerkUser, newBrowserContext }) {
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
  let fixtureSnapshot;
  let writeRequests = 0;

  try {
    await page.goto(baseURL);
    const baseline = await page.evaluate(async () => (await import('/src/lib/seed.ts')).migrate(null));
    assert.ok(baseline.tickets.length, 'The test seed must include a ticket to clone.');
    assert.ok(baseline.services.length > 1, 'The test seed must include two services for the N4 scope check.');

    const [inScopeService, outOfScopeService] = baseline.services;
    const sampleTicket = baseline.tickets[0];
    const inScopeTicket = {
      ...structuredClone(sampleTicket),
      id: inScopeTicketId,
      title: inScopeTitle,
      description: 'Description accessible unique e2e.',
      serviceId: inScopeService.id,
    };
    const outOfScopeTicket = {
      ...structuredClone(sampleTicket),
      id: outOfScopeTicketId,
      title: outOfScopeTitle,
      description: outOfScopeDescription,
      serviceId: outOfScopeService.id,
    };
    const closedTicket = {
      ...structuredClone(sampleTicket),
      id: closedTicketId,
      title: closedTicketTitle,
      serviceId: inScopeService.id,
      status: 'Clos',
      resolvedAt: '2026-01-15T09:00:00.000Z',
      closedAt: '2026-01-15T10:00:00.000Z',
      rootCause: 'Cause racine documentée pour le ticket de test.',
      resolution: 'Solution documentée pour le ticket de test.',
    };
    const conversionEvents = [inScopeTicket, outOfScopeTicket, closedTicket].map((ticket, index) => ({
      id: `audit-ticket-access-${index + 1}`,
      type: 'itsm.ticket.converted',
      action: `Conversion de test vers ${ticket.id}`,
      actor: 'Test navigateur',
      scope: 'Messagerie · support',
      ticketId: ticket.id,
      time: '',
      at: '2026-01-15T10:00:00.000Z',
    }));

    const snapshotFor = (role) => {
      const tickets = role === 'N1'
        ? [inScopeTicket, outOfScopeTicket, closedTicket]
        : role === 'N4'
          ? [inScopeTicket, closedTicket]
          : [];
      return {
        store: {
          ...structuredClone(baseline),
          profile: {
            ...baseline.profile,
            name: `Compte de test ${role}`,
            clearance: `${role} · ${role === 'N1' ? 'Pilotage' : role === 'N4' ? 'Périmètre' : 'Lecture'}`,
          },
          tickets: structuredClone(tickets),
          services: role === 'N4' ? [structuredClone(inScopeService)] : structuredClone(baseline.services),
          assets: role === 'N4' ? [] : structuredClone(baseline.assets),
          conversations: role === 'N4' || role === 'N5' ? [] : structuredClone(baseline.conversations),
          // Keep conversion events in the N4 fixture to exercise the link guard
          // even though the production workspace projection currently hides its audit collection.
          audit: structuredClone(conversionEvents),
        },
        version: 1,
      };
    };
    fixtureSnapshot = snapshotFor('N1');

    await page.route(url => {
      try {
        return new URL(url).pathname === workspacePath;
      } catch {
        return false;
      }
    }, async route => {
      if (route.request().method() !== 'GET') {
        writeRequests += 1;
        return route.fulfill({
          status: 405,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Les écritures sont désactivées dans ce test.' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureSnapshot),
      });
    });

    const signInUrl = await signInClerkUser({
      firstName: 'ANIF',
      lastName: 'Test',
      email: n1Email,
      basePath,
    });
    await page.goto(signInUrl);
    await page.goto(appPath(baseURL, '/tickets'));
    const statusFilter = page.getByTestId('filter-état');
    await statusFilter.waitFor({ state: 'visible' });
    assert.equal(await statusFilter.inputValue(), 'Ouverts',
      'The ticket queue must initially filter to open tickets.');
    assert.equal(await page.getByTestId(`row-ticket-${closedTicketId}`).count(), 0,
      'A closed ticket must be excluded by the initial open-ticket filter.');

    await page.goto(appPath(baseURL, '/audit'));

    const inScopeLink = page.getByTestId(`link-audit-ticket-${inScopeTicketId}`);
    await inScopeLink.waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`link-audit-ticket-${outOfScopeTicketId}`).count(), 1,
      'N1 must see links for tickets in the full workspace.');
    await inScopeLink.click();
    await page.getByTestId('panel-ticket-detail').getByText(inScopeTitle, { exact: true }).waitFor();

    await page.goto(appPath(baseURL, '/audit'));
    const closedLink = page.getByTestId(`link-audit-ticket-${closedTicketId}`);
    await closedLink.waitFor({ state: 'visible' });
    const closedLinkUrl = await closedLink.getAttribute('href');
    assert.ok(closedLinkUrl, 'The closed-ticket conversion event must link to its ticket.');
    assert.equal(new URL(closedLinkUrl, baseURL).searchParams.get('ticket'), closedTicketId,
      'The audit link must carry the exact ticket ID recorded by its event.');
    await closedLink.click();

    const closedTicketDetail = page.getByTestId('panel-ticket-detail');
    await closedTicketDetail.getByText(closedTicketTitle, { exact: true }).waitFor();
    await page.waitForURL(url => url.pathname.endsWith('/tickets') && !url.searchParams.has('ticket'));
    assert.equal(await statusFilter.inputValue(), 'Tous',
      'Navigating to a closed ticket must reset the initial open-ticket filter.');
    await page.getByTestId(`row-ticket-${closedTicketId}`).waitFor({ state: 'visible' });
    assert.equal(await closedTicketDetail.getByTestId('status-ticket').textContent(), 'Clos',
      'The ticket opened from the audit event must remain the closed ticket.');
    const selectedTicketLabel = await closedTicketDetail.locator('.mono').first().textContent();
    assert.equal(selectedTicketLabel?.split(' · ')[0], closedTicketId,
      'The selected detail must show the exact ticket ID from the conversion event.');

    fixtureSnapshot = snapshotFor('N5');
    await page.reload();
    await page.goto(appPath(baseURL, '/audit'));
    await page.getByTestId('text-audit-count').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`link-audit-ticket-${inScopeTicketId}`).count(), 0,
      'N5 must not receive a link to a ticket absent from its workspace data.');
    assert.equal(await page.getByTestId(`link-audit-ticket-${outOfScopeTicketId}`).count(), 0,
      'N5 must not receive any conversion-ticket links.');
    await page.goto(appPath(baseURL, `/tickets?ticket=${encodeURIComponent(inScopeTicketId)}`));
    assert.equal(await page.getByTestId('panel-ticket-detail').count(), 0,
      'Direct navigation as N5 must not display ticket details.');
    assert.equal(await page.getByText(inScopeTitle, { exact: true }).count(), 0);

    fixtureSnapshot = snapshotFor('N4');
    await page.reload();
    await page.goto(appPath(baseURL, '/audit'));
    await page.getByTestId(`link-audit-ticket-${inScopeTicketId}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`link-audit-ticket-${outOfScopeTicketId}`).count(), 0,
      'N4 must not receive a link to a ticket outside its assigned service.');
    await page.getByTestId(`link-audit-ticket-${inScopeTicketId}`).click();
    await page.getByTestId('panel-ticket-detail').getByText(inScopeTitle, { exact: true }).waitFor();

    await page.goto(appPath(baseURL, `/tickets?ticket=${encodeURIComponent(outOfScopeTicketId)}`));
    await page.getByTestId('row-ticket-' + inScopeTicketId).waitFor({ state: 'visible' });
    assert.equal(await page.getByText(outOfScopeTitle, { exact: true }).count(), 0,
      'Direct navigation as N4 must not reveal the out-of-scope ticket title.');
    assert.equal(await page.getByText(outOfScopeDescription, { exact: true }).count(), 0,
      'Direct navigation as N4 must not reveal the out-of-scope ticket description.');
    assert.equal(await page.getByTestId('panel-ticket-detail').getByText(inScopeTicketId, { exact: false }).count(), 1,
      'An out-of-scope URL must not replace the visible details with the inaccessible ticket.');
    assert.equal(writeRequests, 0, 'The browser test must not mutate the shared workspace.');

    console.log('PASS: audit ticket links and direct navigation respect N1, N4, and N5 workspace visibility.');
  } finally {
    await context.close();
  }
}
