// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runIncidentSourceNavigationBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL
//
// The workspace API is intercepted with an in-memory fixture. No shared data is changed.
import assert from 'node:assert/strict';

const workspacePath = '/api/itsm';
const fixtureConversationId = 'e2e-source-navigation-support';
const sourceMessageId = 'e2e-source-message-exact';
const sourceTicketId = 'INC-E2E-SOURCE-NAVIGATION';
const ticketWithoutSourceId = 'INC-E2E-NO-SOURCE';

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the incident source navigation browser test.`);
  return value;
}

function appPath(baseURL, path) {
  const base = new URL(baseURL);
  const prefix = base.pathname.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin).href;
}

/**
 * Verify the incident detail passes its exact conversation and source message
 * to the browser, and that an incident without a source remains usable.
 */
export async function runIncidentSourceNavigationBrowserTest({
  signInClerkUser,
  newBrowserContext,
}) {
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
  let writeRequests = 0;

  try {
    await page.goto(baseURL);
    const baselineStore = await page.evaluate(async () => (await import('/src/lib/seed.ts')).migrate(null));
    const support = baselineStore.conversations.find((conversation) => conversation.kind === 'Support');
    const sampleTicket = baselineStore.tickets[0];
    assert.ok(support && sampleTicket, 'The frontend seed must include Support and ticket fixtures.');

    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `e2e-before-${index + 1}`,
      author: 'Demandeur de test',
      body: `Message antérieur de test ${index + 1}.`,
      time: '',
      at: '2026-01-15T09:00:00.000Z',
    }));
    messages.push({
      id: sourceMessageId,
      author: 'Demandeur de test',
      body: 'Message source exact à ouvrir depuis la fiche incident.',
      time: '',
      at: '2026-01-15T10:00:00.000Z',
    });
    messages.push({
      id: 'e2e-after-source',
      author: 'Demandeur de test',
      body: 'Message suivant pour distinguer la cible.',
      time: '',
      at: '2026-01-15T10:01:00.000Z',
    });

    const linkedTicket = {
      ...structuredClone(sampleTicket),
      id: sourceTicketId,
      title: 'Incident lié au message source exact',
      kind: 'Incident',
      conversationId: fixtureConversationId,
      sourceMessageId,
      status: 'Nouveau',
      openedAt: '2026-01-15T10:00:00.000Z',
      description: 'Incident de test relié à un message précis.',
    };
    const noSourceTicket = {
      ...structuredClone(sampleTicket),
      id: ticketWithoutSourceId,
      title: 'Incident sans message source',
      kind: 'Incident',
      conversationId: null,
      status: 'Nouveau',
      openedAt: '2026-01-15T10:00:00.000Z',
      description: 'La fiche doit rester consultable sans message source.',
    };
    delete noSourceTicket.sourceMessageId;
    const fixtureStore = {
      ...baselineStore,
      profile: {
        ...baselineStore.profile,
        name: 'Compte navigateur de test',
        clearance: 'N1 · Pilotage',
      },
      tickets: [linkedTicket, noSourceTicket],
      conversations: [{
        ...support,
        id: fixtureConversationId,
        title: 'Canal support isolé pour navigation',
        messages,
        readCount: messages.length,
      }],
      audit: [],
      notifications: [],
    };

    await page.route((url) => {
      try {
        return new URL(url).pathname === workspacePath;
      } catch {
        return false;
      }
    }, async (route) => {
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
        body: JSON.stringify({ store: fixtureStore, version: 1 }),
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
    await page.getByTestId('panel-ticket-detail').waitFor({ state: 'visible' });

    const ticketRow = page.getByTestId(`row-ticket-${sourceTicketId}`);
    await ticketRow.waitFor({ state: 'visible' });
    await ticketRow.click();
    const sourceLink = page.getByTestId(`link-source-message-${sourceTicketId}`);
    await sourceLink.waitFor({ state: 'visible' });
    const sourceHref = await sourceLink.getAttribute('href');
    assert.ok(sourceHref, 'The incident detail must provide a link to its source message.');
    const sourceUrl = new URL(sourceHref, baseURL);
    assert.ok(sourceUrl.pathname.endsWith('/messages'),
      'The source link must open the messaging page.');
    assert.equal(sourceUrl.searchParams.get('c'), fixtureConversationId,
      'The source link must target the incident’s exact conversation.');
    assert.equal(sourceUrl.searchParams.get('m'), sourceMessageId,
      'The source link must target the incident’s exact source message.');

    await sourceLink.click();
    await page.getByTestId(`row-conversation-${fixtureConversationId}`).waitFor({ state: 'visible' });
    const targetMessage = page.getByTestId(`message-${sourceMessageId}`);
    await targetMessage.waitFor({ state: 'visible' });
    await page.waitForFunction((messageId) => {
      const element = document.querySelector(`[data-testid="message-${messageId}"]`);
      const list = document.querySelector('[data-testid="list-messages"]');
      if (!element || !list) return false;
      const messageRect = element.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return list.scrollTop > 0
        && messageRect.top >= listRect.top
        && messageRect.bottom <= listRect.bottom
        && element.classList.contains('ring-2');
    }, sourceMessageId);
    assert.equal(await targetMessage.getAttribute('data-message-id'), sourceMessageId);
    assert.match(await targetMessage.getAttribute('class') ?? '', /\bring-2\b/,
      'The exact source message must be highlighted after navigation.');
    assert.equal(await page.getByTestId('message-e2e-before-12').count(), 1);
    assert.equal(await page.getByTestId('message-e2e-after-source').count(), 1);

    await page.goto(appPath(baseURL, '/tickets'));
    await page.getByTestId(`row-ticket-${ticketWithoutSourceId}`).waitFor({ state: 'visible' });
    await page.getByTestId(`row-ticket-${ticketWithoutSourceId}`).click();
    const noSourceDetail = page.getByTestId('panel-ticket-detail');
    await noSourceDetail.getByText('Incident sans message source', { exact: true }).waitFor();
    await noSourceDetail.getByText('La fiche doit rester consultable sans message source.', { exact: true }).waitFor();
    assert.equal(await noSourceDetail.getByTestId(`link-source-message-${ticketWithoutSourceId}`).count(), 0);
    await noSourceDetail.getByTestId('button-edit-ticket').waitFor({ state: 'visible' });
    assert.equal(writeRequests, 0, 'The browser test must not mutate the shared workspace.');

    console.log('PASS: incident source links open and highlight the exact message; source-less incident details remain usable.');
  } finally {
    await context.close();
  }
}
