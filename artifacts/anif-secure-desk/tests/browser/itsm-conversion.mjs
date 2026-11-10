// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runItsmConversionBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL
// Optional:
//   ANIF_E2E_CONVERSION_MESSAGE_ID (choose the isolated fixture message ID)
//
// The workspace and audit-export APIs are intercepted with an in-memory fixture.
// Conversion writes are discarded with the browser context; shared pilot data is untouched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspacePath = '/api/itsm';
const auditExportPath = '/api/itsm/audit/export';
const fixtureConversationId = 'e2e-conversion-support';
const defaultFixtureMessageId = 'e2e-support-message';
const csvHeaders = [
  'Identifiant', 'Action', 'Acteur', 'Compte cible', 'Ancien rôle', 'Nouveau rôle',
  'Ancien périmètre', 'Nouveau périmètre', 'Périmètre', 'Horodatage ISO', 'Heure enregistrée',
];

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the authenticated conversion browser test.`);
  return value;
}

function appPath(baseURL, path) {
  const base = new URL(baseURL);
  const prefix = base.pathname.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, base.origin).href;
}

function parseCsvRow(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ';' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  assert.equal(quoted, false, 'The exported CSV row must have balanced quotes.');
  return cells;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

async function loadWorkspace(page) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: 'same-origin' });
    return { status: response.status, body: await response.json() };
  }, workspacePath);
}

/**
 * Convert a Support message in the authenticated UI, then verify persistence,
 * the audit screen after a page reload, and the exact authenticated CSV export.
 * Clerk sign-in is delegated to the same E2E helper used by the role-handoff test.
 */
export async function runItsmConversionBrowserTest({ signInClerkUser, newBrowserContext }) {
  if (typeof signInClerkUser !== 'function') {
    throw new TypeError('Pass the signInClerkUser helper from the Clerk E2E runner.');
  }
  if (typeof newBrowserContext !== 'function') {
    throw new TypeError('Pass the newBrowserContext helper from the Clerk E2E runner.');
  }

  const baseURL = requiredSetting('ANIF_BASE_URL');
  const n1Email = requiredSetting('ANIF_E2E_N1_EMAIL');
  const requestedMessageId = process.env.ANIF_E2E_CONVERSION_MESSAGE_ID?.trim();
  const basePath = new URL(baseURL).pathname.replace(/\/+$/, '') || '/';
  const context = await newBrowserContext({ acceptDownloads: true });
  const page = await context.newPage();
  let competingContext;
  let competingPage;

  try {
    await page.goto(baseURL);
    const fixtureStore = await page.evaluate(async ({ conversationId, messageId }) => {
      const { migrate } = await import('/src/lib/seed.ts');
      const store = migrate(null);
      const seededSupport = store.conversations.find((conversation) => conversation.kind === 'Support');
      if (!seededSupport) throw new Error('The frontend seed must include a Support conversation.');
      const message = {
        id: messageId,
        author: 'Demandeur de test',
        body: 'Signalement fictif isolé pour vérifier la conversion en incident.',
        time: '',
        at: '2026-01-15T10:00:00.000Z',
      };
      store.profile = {
        ...store.profile,
        name: 'Compte de test navigateur',
        role: 'Direction',
        clearance: 'N1 · Pilotage',
      };
      store.tickets = [];
      store.audit = [];
      store.notifications = [];
      store.conversations = [{
        ...seededSupport,
        id: conversationId,
        title: 'Canal support isolé pour test',
        messages: [message],
        readCount: 1,
      }];
      return structuredClone(store);
    }, {
      conversationId: fixtureConversationId,
      messageId: requestedMessageId || defaultFixtureMessageId,
    });
    const sourceMessage = structuredClone(fixtureStore.conversations[0].messages[0]);
    assert.equal(fixtureStore.tickets.length, 0, 'Every browser execution must start without incidents.');
    assert.deepEqual(fixtureStore.audit, [], 'Every browser execution must start with an empty audit journal.');
    assert.deepEqual(fixtureStore.conversations[0].messages, [sourceMessage]);

    let liveStore = structuredClone(fixtureStore);
    let version = 0;
    let workspaceGetCount = 0;
    let workspacePutCount = 0;
    let auditExportCount = 0;
    const conversionEvents = [];
    const blockUnmockedItsm = (url) => {
      try {
        return new URL(url).pathname.startsWith('/api/itsm');
      } catch {
        return false;
      }
    };
    const isWorkspaceRequest = (url) => {
      try {
        return new URL(url).pathname === workspacePath;
      } catch {
        return false;
      }
    };
    const handleWorkspaceRequest = async (route) => {
      if (route.request().method() === 'GET') {
        workspaceGetCount += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ store: liveStore, version }),
        });
      }
      if (route.request().method() !== 'PUT') return route.abort('blockedbyclient');
      workspacePutCount += 1;

      const submitted = route.request().postDataJSON();
      if (submitted.version !== version) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'La modification a été refusée, car l’espace partagé a changé. L’état distant actuel est joint pour permettre une reprise contrôlée.',
            current: { store: liveStore, version },
          }),
        });
      }
      const oldTicketIds = new Set(liveStore.tickets.map((ticket) => ticket.id));
      const created = (submitted.store.tickets ?? []).filter((ticket) => !oldTicketIds.has(ticket.id));
      assert.equal(created.length, 1, 'The conversion must create exactly one incident in the isolated fixture.');
      const proposedTicket = created[0];
      assert.equal(proposedTicket.sourceMessageId, sourceMessage.id);
      assert.deepEqual(
        liveStore.conversations.find((item) => item.id === fixtureConversationId).messages,
        [sourceMessage],
        'The persisted source message must remain unchanged.',
      );

      const actor = liveStore.profile.name;
      const auditEvent = {
        id: `e2e-conversion-${version + 1}`,
        type: 'itsm.ticket.converted',
        action: `Message ${sourceMessage.id} du canal support converti en incident ${proposedTicket.id}`,
        actor,
        scope: 'Messagerie · support',
        ticketId: proposedTicket.id,
        conversationId: fixtureConversationId,
        sourceMessageId: sourceMessage.id,
        at: new Date().toISOString(),
        time: new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Africa/Libreville',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      };
      const submittedConversation = submitted.store.conversations.find(
        (item) => item.id === fixtureConversationId,
      );
      const submittedMessages = submittedConversation?.messages ?? [];
      const appendedMessages = submittedMessages.slice(1).map((item, index) => ({
        ...item,
        id: `e2e-system-message-${version + 1}-${index + 1}`,
        author: actor,
        at: auditEvent.at,
        time: auditEvent.time,
      }));
      liveStore = {
        ...liveStore,
        tickets: [{
          ...proposedTicket,
          requester: actor,
          requesterId: actor,
          updates: [{
            author: actor,
            body: `Ticket créé en ${proposedTicket.priority} (impact ${proposedTicket.impact}, urgence ${proposedTicket.urgency}).`,
            at: auditEvent.at,
          }],
        }, ...liveStore.tickets],
        conversations: liveStore.conversations.map((item) => item.id === fixtureConversationId
          ? { ...item, messages: [sourceMessage, ...appendedMessages] }
          : item),
        audit: [auditEvent, ...liveStore.audit],
        notifications: submitted.store.notifications ?? liveStore.notifications,
      };
      version += 1;
      conversionEvents.push(auditEvent);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ store: liveStore, version }),
      });
    };
    const isAuditExportRequest = (url) => {
      try {
        return new URL(url).pathname === auditExportPath;
      } catch {
        return false;
      }
    };
    const handleAuditExportRequest = async (route) => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
      auditExportCount += 1;
      const rows = [
        csvHeaders,
        ...conversionEvents.map((event) => [
          event.id, event.action, event.actor, '', '', '', '', '', event.scope, event.at, event.time,
        ]),
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'content-disposition': 'attachment; filename="journal-anif-e2e.csv"' },
        body: csv,
      });
    };
    const installFixtureRoutes = async (targetContext) => {
      await targetContext.route(blockUnmockedItsm, (route) => route.abort('blockedbyclient'));
      await targetContext.route(isWorkspaceRequest, handleWorkspaceRequest);
      await targetContext.route(isAuditExportRequest, handleAuditExportRequest);
    };
    await installFixtureRoutes(context);

    const signInUrl = await signInClerkUser({
      firstName: 'ANIF',
      lastName: 'Test',
      email: n1Email,
      basePath,
    });
    await page.goto(signInUrl);
    await page.goto(appPath(baseURL, '/messages'));
    await page.getByTestId('link-nav-messages').waitFor({ state: 'visible' });
    competingContext = await newBrowserContext({});
    competingPage = await competingContext.newPage();
    await installFixtureRoutes(competingContext);
    const competingSignInUrl = await signInClerkUser({
      firstName: 'ANIF',
      lastName: 'Test',
      email: process.env.ANIF_E2E_SECOND_N1_EMAIL?.trim() || n1Email,
      basePath,
    });
    await competingPage.goto(competingSignInUrl);
    await competingPage.goto(appPath(baseURL, '/messages'));
    await competingPage.getByTestId('link-nav-messages').waitFor({ state: 'visible' });

    const initial = await loadWorkspace(page);
    assert.equal(initial.status, 200, 'The isolated workspace fixture request must succeed.');
    const { store } = initial.body;
    assert.equal(
      store.profile?.clearance?.slice(0, 2),
      'N1',
      'The conversion test account must have the authorized N1 role.',
    );
    const competingInitial = await loadWorkspace(competingPage);
    assert.equal(competingInitial.status, 200);
    assert.equal(competingInitial.body.version, initial.body.version);
    assert.equal(
      competingInitial.body.store.profile?.clearance?.slice(0, 2),
      'N1',
      'The competing authenticated browser session must also be authorized as N1.',
    );

    const conversation = store.conversations.find((item) => item.id === fixtureConversationId);
    const message = conversation?.messages.find((item) => item.id === sourceMessage.id);
    assert.ok(conversation && message, 'The isolated fixture must contain its intact Support message.');
    assert.equal(store.tickets.some((ticket) => ticket.sourceMessageId === message.id), false);
    const title = `Conversion navigateur ${message.id}`;
    const waitForConversionSave = (targetPage) => targetPage.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== 'PUT' || new URL(response.url()).pathname !== workspacePath) {
        return false;
      }
      try {
        return request.postDataJSON().store?.tickets?.some(
          (ticket) => ticket.sourceMessageId === message.id,
        ) ?? false;
      } catch {
        return false;
      }
    });

    const prepareConversion = async (targetPage, sessionTitle) => {
      await targetPage.getByTestId(`row-conversation-${conversation.id}`).click();
      await targetPage.getByTestId(`button-convert-${message.id}`).click();
      await targetPage.getByTestId('input-convert-title').fill(sessionTitle);
      await targetPage.getByTestId('input-convert-summary').fill(
        `Vérification navigateur authentifiée. Message source : ${message.id}. Symptôme fictif relu.`,
      );
      await targetPage.getByTestId('checkbox-no-sensitive').check();
    };
    await Promise.all([
      prepareConversion(page, title),
      prepareConversion(competingPage, `${title} · deuxième session`),
    ]);
    const saveResponses = [
      waitForConversionSave(page),
      waitForConversionSave(competingPage),
    ];
    await Promise.all([
      page.getByTestId('button-submit-convert').click(),
      competingPage.getByTestId('button-submit-convert').click(),
    ]);

    const [saveResponse, competingSaveResponse] = await Promise.all(saveResponses);
    assert.deepEqual(
      [saveResponse.status(), competingSaveResponse.status()].sort(),
      [200, 409],
      'Exactly one concurrent conversion must succeed; the stale session must receive a conflict.',
    );
    const acceptedResponse = saveResponse.status() === 200 ? saveResponse : competingSaveResponse;
    const conflictResponse = saveResponse.status() === 409 ? saveResponse : competingSaveResponse;
    const saveResult = await acceptedResponse.json();
    const conflictResult = await conflictResponse.json();
    const newTicket = (saveResult.store.tickets ?? []).find(
      (ticket) => ticket.sourceMessageId === message.id,
    );
    assert.ok(newTicket, 'The server snapshot must contain the converted incident.');
    assert.equal(newTicket.conversationId, conversation.id);
    assert.ok(
      [title, `${title} · deuxième session`].includes(newTicket.title),
      'The winning session must be the only source of the persisted ticket title.',
    );

    const savedAuditEvents = (saveResult.store.audit ?? []).filter(
      (event) => event.type === 'itsm.ticket.converted' && event.sourceMessageId === message.id,
    );
    assert.equal(savedAuditEvents.length, 1, 'The server must record exactly one conversion audit event.');
    const auditEvent = savedAuditEvents[0];
    assert.equal(auditEvent.ticketId, newTicket.id);
    assert.equal(auditEvent.actor, store.profile.name);
    const auditAction = `Message ${message.id} du canal support converti en incident ${newTicket.id}`;
    assert.equal(auditEvent.action, auditAction);

    assert.equal(conflictResult.current?.version, saveResult.version);
    assert.equal(
      conflictResult.current?.store?.tickets?.filter((ticket) => ticket.sourceMessageId === message.id).length,
      1,
      'The losing session must receive the current server incident.',
    );
    assert.equal(
      conflictResult.current?.store?.audit?.filter(
        (event) => event.type === 'itsm.ticket.converted' && event.sourceMessageId === message.id,
      ).length,
      1,
      'The conflict snapshot must contain only the winning conversion audit event.',
    );

    const losingPage = saveResponse.status() === 409 ? page : competingPage;
    await losingPage.getByTestId('alert-storage').waitFor({ state: 'visible' });
    assert.match(
      await losingPage.getByTestId('alert-storage').innerText(),
      /Version distante affichée\s*:\s*1/,
      'The losing session must display the latest server version after the conflict.',
    );
    await losingPage.getByTestId(`button-linked-${message.id}`).waitFor({ state: 'visible' });
    assert.match(await losingPage.getByTestId(`button-linked-${message.id}`).innerText(), newTicket.id);
    assert.equal(await losingPage.getByTestId(`button-convert-${message.id}`).count(), 0);

    await Promise.all([page.reload(), competingPage.reload()]);
    for (const sessionPage of [page, competingPage]) {
      await sessionPage.getByTestId('link-nav-messages').waitFor({ state: 'visible' });
      await sessionPage.getByTestId(`row-conversation-${conversation.id}`).click();
      await sessionPage.getByTestId(`button-linked-${message.id}`).waitFor({ state: 'visible' });
      assert.match(await sessionPage.getByTestId(`button-linked-${message.id}`).innerText(), newTicket.id);
      await sessionPage.getByTestId(`side-ticket-${newTicket.id}`).waitFor({ state: 'visible' });
      assert.equal(await sessionPage.getByTestId(`button-convert-${message.id}`).count(), 0);
    }

    await page.goto(appPath(baseURL, '/audit'));
    await page.getByTestId('input-search-audit').fill(message.id);
    await page.getByText(auditAction, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText(auditAction, { exact: true }).count(), 1);
    assert.match(await page.getByTestId('text-audit-count').innerText(), /^\(1 \//);

    const exportButton = page.getByTestId('button-export-csv');
    assert.match(await exportButton.innerText(), /Exporter la sélection \(1\)/);
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const csv = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
    const rows = csv.trimEnd().split(/\r?\n/);
    assert.equal(rows.length, 2, 'The authenticated export must contain only its header and this conversion.');
    const headers = parseCsvRow(rows[0]);
    const values = parseCsvRow(rows[1]);
    assert.equal(values.length, headers.length);
    const exported = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    assert.equal(exported.Action, auditAction);
    assert.equal(exported.Acteur, auditEvent.actor);
    assert.equal(csv.split(newTicket.id).length - 1, 1);
    assert.equal(csv.split(message.id).length - 1, 1);

    const final = await loadWorkspace(page);
    assert.equal(final.status, 200, 'The in-memory workspace fixture must remain available after reload.');
    assert.equal(
      (final.body.store.tickets ?? []).filter((ticket) => ticket.sourceMessageId === message.id).length,
      1,
      'Exactly one incident must remain linked to the source message after reload.',
    );
    assert.equal(
      (final.body.store.audit ?? []).filter(
        (event) => event.type === 'itsm.ticket.converted' && event.sourceMessageId === message.id,
      ).length,
      1,
      'Exactly one conversion audit event must remain after reload.',
    );
    assert.deepEqual(
      final.body.store.conversations.find((item) => item.id === conversation.id).messages[0],
      sourceMessage,
      'The source message must remain intact after conversion.',
    );
    assert.deepEqual(
      fixtureStore.conversations[0].messages,
      [sourceMessage],
      'The reusable baseline fixture must remain unmodified.',
    );
    assert.equal(conversionEvents.length, 1, 'Only one conversion audit event may be created.');
    assert.ok(workspaceGetCount >= 2, 'Initial load and reload must use the isolated workspace fixture.');
    assert.equal(workspacePutCount, 2, 'Both authorized sessions must attempt to save the conversion.');
    assert.equal(auditExportCount, 1, 'The CSV download must use the isolated export fixture.');
    console.log(`PASS: authenticated browser converted isolated fixture ${message.id} to ${newTicket.id}; shared pilot data was not used.`);
  } finally {
    if (competingContext) await competingContext.close();
    await context.close();
  }
}
