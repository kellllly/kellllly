import test from 'node:test';
import assert from 'node:assert/strict';
import {
  priorityFor, SLA_POLICIES, getDeadlines, slaProgress, formatWAT, csvCell, toCsv,
  filterAuditEvents, getAuditFilterResult, auditEventsToCsv, AUDIT_EMPTY_STATE_MESSAGE,
  hasAuditExportSelection, runAuditExport, getRecentAuditDateRange,
  getAuditCalendarDayRange, getAuditExportFilename,
  createAuditExportRunner, getAuditExportErrorMessage, readAuditCsvResponse,
} from '../src/lib/itsm.ts';
import { createItsmAuditExportHandler } from '../../api-server/src/routes/itsm-audit-export.ts';

const opened = '2026-10-31T09:00:00.000Z';

test('the nine impact/urgency combinations follow the documented matrix', () => {
  const expected = [['P1', 'P2', 'P3'], ['P2', 'P3', 'P3'], ['P3', 'P3', 'P4']];
  for (let impact = 1; impact <= 3; impact++) {
    for (let urgency = 1; urgency <= 3; urgency++) {
      assert.equal(priorityFor(impact, urgency), expected[impact - 1][urgency - 1]);
    }
  }
  assert.throws(() => priorityFor(0, 2), RangeError);
  assert.throws(() => priorityFor(1, 4), RangeError);
});

test('all PDF acknowledgement/resolution targets are exact continuous durations', () => {
  const minutes = { P1: [15, 120], P2: [30, 240], P3: [120, 480], P4: [240, 2880] };
  for (const [priority, [ack, resolve]] of Object.entries(minutes)) {
    const actual = getDeadlines(opened, priority);
    assert.equal(Date.parse(actual.acknowledgeBy) - Date.parse(opened), ack * 60_000);
    assert.equal(Date.parse(actual.resolveBy) - Date.parse(opened), resolve * 60_000);
    assert.equal(SLA_POLICIES[priority].acknowledgeMinutes, ack);
    assert.equal(SLA_POLICIES[priority].resolveMinutes, resolve);
  }
});

test('priority changes keep original opening and invalid inputs fail explicitly', () => {
  assert.equal(getDeadlines(opened, 'P1').resolveBy, '2026-10-31T11:00:00.000Z');
  assert.equal(getDeadlines(opened, 'P4').resolveBy, '2026-11-02T09:00:00.000Z');
  assert.throws(() => getDeadlines('bad date', 'P1'), RangeError);
  assert.throws(() => getDeadlines(opened, 'P5'), RangeError);
});

test('SLA distinguishes running, 80% warning, breach and completed compliance', () => {
  const deadline = getDeadlines(opened, 'P1').acknowledgeBy;
  assert.equal(slaProgress(opened, deadline, null, Date.parse(opened)).state, 'ok');
  assert.equal(slaProgress(opened, deadline, null, Date.parse(opened) + 12 * 60_000).state, 'warning');
  assert.equal(slaProgress(opened, deadline, null, Date.parse(deadline)).state, 'breach');
  assert.equal(slaProgress(opened, deadline, '2026-10-31T09:10:00Z').state, 'met');
  assert.equal(slaProgress(opened, deadline, '2026-10-31T09:16:00Z').state, 'breach');
  assert.equal(slaProgress(opened, deadline, null, Date.parse(opened) - 60_000).fraction, 0);
  assert.equal(slaProgress(opened, deadline, null, Date.parse(deadline) + 60_000).fraction, 1);
  assert.throws(() => slaProgress(opened, opened), RangeError);
  assert.throws(() => slaProgress(opened, deadline, '2026-10-30T09:00:00Z'), RangeError);
});

test('Libreville clock is independent of the host timezone', () => {
  assert.equal(formatWAT(opened, 'time'), '10:00');
  assert.equal(formatWAT('not-a-date'), 'Date invalide');
});

test('recent journal periods use inclusive Libreville dates, even across UTC midnight', () => {
  const now = new Date('2026-11-01T23:30:00.000Z'); // 2026-11-02 in WAT

  assert.deepEqual(getRecentAuditDateRange(7, now), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(getRecentAuditDateRange(30, now), { from: '2026-10-04', to: '2026-11-02' });
  assert.deepEqual(getAuditCalendarDayRange(0, now), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(getAuditCalendarDayRange(1, now), { from: '2026-11-01', to: '2026-11-01' });
  assert.throws(() => getRecentAuditDateRange(0, now), RangeError);
  assert.throws(() => getAuditCalendarDayRange(-1, now), RangeError);
  assert.throws(() => getAuditCalendarDayRange(1.5, now), RangeError);
  assert.throws(() => getRecentAuditDateRange(7, new Date('invalid')), RangeError);
  assert.throws(() => getAuditCalendarDayRange(0, new Date('invalid')), RangeError);
});

test('journal CSV filename uses the Gabon date when it differs from UTC', () => {
  assert.equal(
    getAuditExportFilename(new Date('2026-10-31T22:59:59.000Z')),
    'journal-anif-2026-10-31.csv',
  );
  assert.equal(
    getAuditExportFilename(new Date('2026-10-31T23:00:00.000Z')),
    'journal-anif-2026-11-01.csv',
  );
});

test('CSV cells escape quotes, newlines and spreadsheet formulas', () => {
  assert.equal(csvCell('Titre "cité"; suite'), '"Titre ""cité""; suite"');
  for (const formula of ['=SUM(A1)', '+CMD', '-CMD', '@SUM(A1)', '  =1+1', '\t=1+1', '\n=1+1']) {
    assert.ok(csvCell(formula).startsWith('"\''));
  }
  assert.equal(csvCell(-2), '"-2"');
  assert.equal(csvCell(null), '""');
  assert.equal(toCsv(['Événement'], [['Créé']]), '\uFEFF"Événement"\r\n"Créé"\r\n');
  assert.throws(() => toCsv(['Une colonne'], [['a', 'b']]), RangeError);
});

test('server audit download neutralizes formulas and escapes CSV cell content', async () => {
  let csv = '';
  const response = {
    headersSent: false,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { csv = body; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
  const handler = createItsmAuditExportHandler({
    resolveActor: async () => ({ id: 'admin', role: 'N1', serviceIds: [] }),
    loadAuditEvents: async () => [{
      id: -2,
      action: '=SUM(A1)',
      actor: '+CMD',
      targetUserId: '-CMD',
      previousRole: '  =1+1',
      nextRole: '\uFEFF=1+1',
      previousServiceIds: ['\t=1+1'],
      serviceIds: ['service;"one"'],
      scope: 'Messagerie; "centrale"\njour',
      at: '2026-10-31T09:00:00.000Z',
    }],
  });

  await handler({ query: {} }, response);

  assert.equal(response.statusCode, undefined);
  assert.match(response.headers['Content-Type'], /text\/csv; charset=utf-8/);
  assert.match(response.headers['Content-Disposition'], /attachment; filename="journal-anif-/);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"-2";"\'=SUM(A1)";"\'+CMD";"\'-CMD";"\'  =1+1";"\'\uFEFF=1+1";"\'\t=1+1";"service;""one""";"Messagerie; ""centrale""\njour";"2026-10-31T09:00:00.000Z"'));
  assert.ok(!csv.includes('"=SUM(A1)"'));
  assert.ok(!csv.includes('"+CMD"'));
  assert.ok(!csv.includes('"-CMD"'));
});

test('failed audit read returns an explicit server error instead of a CSV download', async () => {
  const response = {
    headersSent: false,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    send(body) { this.download = body; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
  const failure = new Error('database unavailable');
  const handler = createItsmAuditExportHandler({
    resolveActor: async () => ({ id: 'admin', role: 'N1', serviceIds: [] }),
    loadAuditEvents: async () => { throw failure; },
  });

  await handler({ query: {}, log: { error() {} } }, response);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: 'Impossible de lire le journal d’activité. Réessayez plus tard.',
  });
  assert.equal(response.download, undefined);
  assert.deepEqual(response.headers, {});
});

test('client rejects an unsuccessful audit response before reading a CSV blob', async () => {
  let blobRead = false;
  await assert.rejects(
    readAuditCsvResponse({
      ok: false,
      async json() { return { error: 'Impossible de lire le journal d’activité. Réessayez plus tard.' }; },
      async blob() { blobRead = true; return new Blob(['unexpected CSV']); },
    }),
    /Impossible de lire le journal d’activité/u,
  );
  assert.equal(blobRead, false);
});

test('journal export matches the visible rows and count with combined scope, WAT dates and text', () => {
  const audit = [
    { id: 'start', at: '2026-06-01T23:00:00.000Z', action: 'Export contrôlé', actor: 'Agent ANIF', scope: 'Messagerie', time: '00:00' },
    { id: 'end', at: '2026-06-02T22:59:59.999Z', action: 'Export sécurisé', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'before', at: '2026-06-01T22:59:59.999Z', action: 'Export avant plage', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'after', at: '2026-06-02T23:00:00.000Z', action: 'Export après plage', actor: 'Agent ANIF', scope: 'Messagerie', time: '00:00' },
    { id: 'scope', at: '2026-06-02T12:00:00.000Z', action: 'Export autre périmètre', actor: 'Agent ANIF', scope: 'Tickets', time: '13:00' },
    { id: 'query', at: '2026-06-02T12:00:00.000Z', action: 'Consultation', actor: 'Agent ANIF', scope: 'Messagerie', time: '13:00' },
    { id: 'invalid', at: 'date invalide', action: 'Export date invalide', actor: 'Agent ANIF', scope: 'Messagerie', time: '10:00' },
    { id: 'legacy', action: 'Export historique', actor: 'Agent ANIF', scope: 'Messagerie', time: '10:00' },
  ];
  const filters = { scope: 'Messagerie', from: '2026-06-02', to: '2026-06-02', query: 'export' };

  // The same filtered collection drives the visible rows, count and CSV download.
  const visibleEvents = filterAuditEvents(audit, filters);
  assert.deepEqual(visibleEvents.map(event => event.id), ['start', 'end']);
  const displayedCount = visibleEvents.length;
  const csv = auditEventsToCsv(visibleEvents);
  assert.equal(displayedCount, 2);
  assert.equal(
    csv,
    toCsv(
      [
        'horodatage_iso', 'horodatage_affiche', 'action', 'acteur', 'compte_cible',
        'ancien_role', 'nouveau_role', 'ancien_perimetre', 'nouveau_perimetre', 'perimetre',
      ],
      [
        ['2026-06-01T23:00:00.000Z', formatWAT('2026-06-01T23:00:00.000Z', 'datetime'), 'Export contrôlé', 'Agent ANIF', '', '', '', '', '', 'Messagerie'],
        ['2026-06-02T22:59:59.999Z', formatWAT('2026-06-02T22:59:59.999Z', 'datetime'), 'Export sécurisé', 'Agent ANIF', '', '', '', '', '', 'Messagerie'],
      ],
    ),
  );
  assert.equal(csv.slice(1).split('\r\n').filter(Boolean).length, displayedCount + 1);
  assert.ok(!csv.includes('Export avant plage'));
  assert.ok(!csv.includes('Export après plage'));
  assert.ok(!csv.includes('autre périmètre'));
  assert.ok(!csv.includes('Consultation'));
  assert.ok(!csv.includes('date invalide'));
  assert.ok(!csv.includes('Export historique'));
});

test('time-only journal searches return the same visible events and CSV rows', () => {
  const audit = [
    { id: 'matching-time', at: '2026-06-02T12:00:00.000Z', action: 'Connexion', actor: 'Agent ANIF', scope: 'Messagerie', time: '13:00' },
    { id: 'other-time', at: '2026-06-02T13:00:00.000Z', action: 'Déconnexion', actor: 'Agent ANIF', scope: 'Messagerie', time: '14:00' },
    { id: 'historical-time', action: 'Trace historique', actor: 'Ancien agent', scope: 'Messagerie', time: '09:17' },
  ];
  const visibleEvents = filterAuditEvents(audit, {
    scope: 'Tous', from: '', to: '', query: '09:17',
  });
  const csv = auditEventsToCsv(visibleEvents);

  assert.deepEqual(visibleEvents.map(event => event.id), ['historical-time']);
  assert.equal(csv.slice(1).split('\r\n').filter(Boolean).length - 1, visibleEvents.length);
  assert.match(csv, /"Trace historique"/);
  assert.match(csv, /09:17/);
  assert.doesNotMatch(csv, /matching-time|other-time|Connexion|Déconnexion/);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 2);
});

test('journal searches ignore accent, case, and composed versus decomposed accents', () => {
  const audit = [
    { id: 'accented', at: '2026-06-02T12:00:00.000Z', action: 'Habilitation modifiée', actor: 'Élodie', scope: 'Messagerie', time: '13:00' },
    { id: 'unaccented', at: '2026-06-02T12:01:00.000Z', action: 'Habilitation modifiee', actor: 'Elodie', scope: 'Messagerie', time: '13:01' },
    { id: 'other', at: '2026-06-02T12:02:00.000Z', action: 'Habilitation supprimée', actor: 'Élodie', scope: 'Messagerie', time: '13:02' },
  ];
  const queries = ['MODIFIEE', 'modifiée', '  modifi\u0065\u0301e  '];

  for (const query of queries) {
    const visibleEvents = filterAuditEvents(audit, {
      scope: 'Tous', from: '', to: '', query,
    });
    const csv = auditEventsToCsv(visibleEvents);
    assert.deepEqual(visibleEvents.map(event => event.id), ['accented', 'unaccented']);
    assert.equal(csv.split('\r\n').filter(Boolean).length - 1, visibleEvents.length);
    assert.match(csv, /Habilitation modifiée/u);
    assert.match(csv, /Habilitation modifiee/u);
    assert.doesNotMatch(csv, /Habilitation supprimée/u);
  }
});

test('recent period dates remain combined with the selected journal scope and text', () => {
  const range = getRecentAuditDateRange(7, new Date('2026-11-01T23:30:00.000Z'));
  const audit = [
    { id: 'start', at: '2026-10-26T23:00:00.000Z', action: 'Export début', actor: 'Agent ANIF', scope: 'Messagerie', time: '00:00' },
    { id: 'end', at: '2026-11-02T22:59:59.999Z', action: 'Export fin', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'before', at: '2026-10-26T22:59:59.999Z', action: 'Export avant', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'scope', at: '2026-11-02T12:00:00.000Z', action: 'Export autre périmètre', actor: 'Agent ANIF', scope: 'Tickets', time: '13:00' },
    { id: 'query', at: '2026-11-02T12:00:00.000Z', action: 'Consultation', actor: 'Agent ANIF', scope: 'Messagerie', time: '13:00' },
  ];

  assert.deepEqual(filterAuditEvents(audit, {
    scope: 'Messagerie', query: 'export', ...range,
  }).map(event => event.id), ['start', 'end']);
});

test('today and yesterday use inclusive Libreville boundaries without clearing text or scope', () => {
  const now = new Date('2026-11-01T23:30:00.000Z'); // 2026-11-02 in WAT
  const yesterday = getAuditCalendarDayRange(1, now);
  const audit = [
    { id: 'before', at: '2026-10-31T22:59:59.999Z', action: 'Export avant hier', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'start', at: '2026-10-31T23:00:00.000Z', action: 'Export début hier', actor: 'Agent ANIF', scope: 'Messagerie', time: '00:00' },
    { id: 'end', at: '2026-11-01T22:59:59.999Z', action: 'Export fin hier', actor: 'Agent ANIF', scope: 'Messagerie', time: '23:59' },
    { id: 'today', at: '2026-11-01T23:00:00.000Z', action: 'Export aujourd’hui', actor: 'Agent ANIF', scope: 'Messagerie', time: '00:00' },
    { id: 'scope', at: '2026-11-01T12:00:00.000Z', action: 'Export autre périmètre', actor: 'Agent ANIF', scope: 'Tickets', time: '13:00' },
    { id: 'query', at: '2026-11-01T12:00:00.000Z', action: 'Consultation', actor: 'Agent ANIF', scope: 'Messagerie', time: '13:00' },
  ];

  assert.deepEqual(filterAuditEvents(audit, {
    scope: 'Messagerie', query: 'export', ...yesterday,
  }).map(event => event.id), ['start', 'end']);
});

test('role changes can be searched and exported with their before-and-after scope', () => {
  const event = {
    id: 'role-change',
    type: 'itsm.role.changed',
    at: '2026-06-02T12:00:00.000Z',
    action: 'Habilitation modifiée',
    actor: 'admin-1',
    targetUserId: 'account-2',
    previousRole: 'N5',
    nextRole: 'N4',
    previousServiceIds: [],
    serviceIds: ['service-1'],
    scope: 'Tous les services → Support central',
    time: '13:00',
  };
  assert.deepEqual(
    filterAuditEvents([event], { scope: 'Tous', from: '', to: '', query: 'account-2' }).map(item => item.id),
    ['role-change'],
  );
  assert.equal(
    auditEventsToCsv([event]),
    toCsv(
      [
        'horodatage_iso', 'horodatage_affiche', 'action', 'acteur', 'compte_cible',
        'ancien_role', 'nouveau_role', 'ancien_perimetre', 'nouveau_perimetre', 'perimetre',
      ],
      [[
        event.at, formatWAT(event.at, 'datetime'), event.action, event.actor, event.targetUserId,
        event.previousRole, event.nextRole, '', 'service-1', event.scope,
      ]],
    ),
  );
});

test('combined journal filters include both WAT calendar-day boundaries and keep formula escaping', () => {
  const audit = [
    { id: 'start', at: '2026-06-01T23:00:00.000Z', action: 'Export du jour', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
    { id: 'end', at: '2026-06-02T22:59:59.999Z', action: '=Export du jour', actor: 'Agent', scope: 'Messagerie', time: '23:59' },
    { id: 'outside', at: '2026-06-02T23:00:00.000Z', action: 'Export demain', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
  ];
  const filtered = filterAuditEvents(audit, {
    scope: 'Messagerie', from: '2026-06-02', to: '2026-06-02', query: 'export',
  });

  assert.deepEqual(filtered.map(event => event.id), ['start', 'end']);
  assert.match(auditEventsToCsv(filtered), /"'=Export du jour"/);
});

test('combined journal filters show the empty state and cannot start a CSV download', () => {
  const audit = [
    { id: 'other-scope', at: '2026-06-02T12:00:00.000Z', action: 'Export quotidien', actor: 'Agent', scope: 'Tickets', time: '13:00' },
    { id: 'other-day', at: '2026-06-03T12:00:00.000Z', action: 'Export quotidien', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
  ];
  const filtered = filterAuditEvents(audit, {
    scope: 'Messagerie', from: '2026-06-02', to: '2026-06-02', query: 'introuvable',
  });
  let downloadCount = 0;

  assert.deepEqual(filtered, []);
  assert.equal(AUDIT_EMPTY_STATE_MESSAGE, 'Aucun événement ne correspond à ces filtres.');
  assert.equal(hasAuditExportSelection(filtered), false);
  assert.equal(runAuditExport(filtered, () => { downloadCount += 1; }), undefined);
  assert.equal(downloadCount, 0);
});

test('a delayed journal export ignores repeated clicks and downloads only once', async () => {
  const runner = createAuditExportRunner();
  const events = [{ id: 'event' }];
  let requestCount = 0;
  let downloadCount = 0;
  let isExporting = false;
  let exportError = 'ancienne erreur';
  let releaseExport;
  const pendingExport = runner.run(events, async () => {
    requestCount += 1;
    await new Promise(resolve => { releaseExport = resolve; });
    downloadCount += 1;
  }, (running, error) => {
    isExporting = running;
    if (error !== undefined) exportError = error;
  });

  assert.equal(runner.isRunning, true);
  assert.equal(isExporting, true);
  assert.equal(exportError, '');
  assert.equal(requestCount, 1);
  for (let click = 0; click < 5; click += 1) {
    assert.equal(runner.run(events, async () => {
      requestCount += 1;
      downloadCount += 1;
    }), undefined);
  }

  releaseExport();
  await pendingExport;
  assert.equal(requestCount, 1);
  assert.equal(downloadCount, 1);
  assert.equal(runner.isRunning, false);
  assert.equal(isExporting, false);
});

test('a failed journal export reports its error, unlocks the button, and permits retry', async () => {
  const runner = createAuditExportRunner();
  const events = [{ id: 'event' }];
  const failure = new Error('Serveur indisponible.');
  let isExporting = false;
  let exportError = '';

  const failedExport = runner.run(events, async () => { throw failure; }, (running, error) => {
    isExporting = running;
    if (error !== undefined) exportError = error;
  });
  assert.equal(runner.isRunning, true);
  await assert.rejects(failedExport, failure);
  assert.equal(exportError, getAuditExportErrorMessage(failure));
  assert.equal(exportError, 'Serveur indisponible.');
  assert.equal(isExporting, false);
  assert.equal(runner.isRunning, false);

  let retryCount = 0;
  await runner.run(events, async () => { retryCount += 1; });
  assert.equal(retryCount, 1);
  assert.equal(runner.isRunning, false);
});

test('a journal export timeout aborts the request, unlocks the button, and permits retry', async () => {
  const runner = createAuditExportRunner(15);
  const events = [{ id: 'event' }];
  let isExporting = false;
  let exportError = '';
  let requestSignal;

  const stalledExport = runner.run(events, signal => {
    requestSignal = signal;
    return new Promise(() => {});
  }, (running, error) => {
    isExporting = running;
    if (error !== undefined) exportError = error;
  });

  await assert.rejects(stalledExport, /Le serveur ne répond pas/u);
  assert.equal(requestSignal.aborted, true);
  assert.equal(exportError, 'Le serveur ne répond pas. Réessayez.');
  assert.equal(isExporting, false);
  assert.equal(runner.isRunning, false);

  let retryCount = 0;
  await runner.run(events, async () => { retryCount += 1; });
  assert.equal(retryCount, 1);
  assert.equal(runner.isRunning, false);
});

test('cancelling a journal export aborts the request and unlocks the button', async () => {
  const runner = createAuditExportRunner(5_000);
  const events = [{ id: 'event' }];
  let isExporting = false;
  let exportError = '';
  let requestSignal;
  const cancelledExport = runner.run(events, signal => {
    requestSignal = signal;
    return new Promise(() => {});
  }, (running, error) => {
    isExporting = running;
    if (error !== undefined) exportError = error;
  });

  runner.cancel();
  await assert.rejects(cancelledExport, /Export annulé/u);
  assert.equal(requestSignal.aborted, true);
  assert.equal(exportError, 'Export annulé.');
  assert.equal(isExporting, false);
  assert.equal(runner.isRunning, false);
});

test('journal "from" filter uses an inclusive WAT day start on its own', () => {
  const audit = [
    { id: 'before', at: '2026-06-01T22:59:59.999Z', action: 'Avant', actor: 'Agent', scope: 'Messagerie', time: '23:59' },
    { id: 'start', at: '2026-06-01T23:00:00.000Z', action: 'Début WAT', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
    { id: 'after', at: '2026-06-02T12:00:00.000Z', action: 'Après', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
    { id: 'legacy', action: 'Historique sans date', actor: 'Agent', scope: 'Messagerie', time: '10:00' },
  ];

  const filtered = filterAuditEvents(audit, {
    scope: 'Tous', from: '2026-06-02', to: '', query: '',
  });
  assert.deepEqual(filtered.map(event => event.id), ['start', 'after']);
});

test('journal "to" filter uses an inclusive WAT day end on its own', () => {
  const audit = [
    { id: 'before', at: '2026-06-02T12:00:00.000Z', action: 'Avant', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
    { id: 'end', at: '2026-06-02T22:59:59.999Z', action: 'Fin WAT', actor: 'Agent', scope: 'Messagerie', time: '23:59' },
    { id: 'after', at: '2026-06-02T23:00:00.000Z', action: 'Après', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
    { id: 'legacy', action: 'Historique sans date', actor: 'Agent', scope: 'Messagerie', time: '10:00' },
  ];

  const filtered = filterAuditEvents(audit, {
    scope: 'Tous', from: '', to: '2026-06-02', query: '',
  });
  assert.deepEqual(filtered.map(event => event.id), ['before', 'end']);
});

test('single-bound date exports match the visible events and displayed count', () => {
  const audit = [
    { id: 'before', at: '2026-06-01T22:59:59.999Z', action: 'Avant la borne', actor: 'Agent', scope: 'Messagerie', time: '23:59' },
    { id: 'start', at: '2026-06-01T23:00:00.000Z', action: 'Début WAT', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
    { id: 'middle', at: '2026-06-02T12:00:00.000Z', action: 'Dans la période', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
    { id: 'end', at: '2026-06-02T22:59:59.999Z', action: 'Fin WAT', actor: 'Agent', scope: 'Messagerie', time: '23:59' },
    { id: 'after', at: '2026-06-02T23:00:00.000Z', action: 'Après la borne', actor: 'Agent', scope: 'Messagerie', time: '00:00' },
    { id: 'future', at: '2026-06-03T12:00:00.000Z', action: 'Jour suivant', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
    { id: 'legacy', action: 'Historique sans date', actor: 'Agent', scope: 'Messagerie', time: '10:00' },
  ];
  const cases = [
    { filters: { scope: 'Tous', from: '2026-06-02', to: '', query: '' }, ids: ['start', 'middle', 'end', 'after', 'future'] },
    { filters: { scope: 'Tous', from: '', to: '2026-06-02', query: '' }, ids: ['before', 'start', 'middle', 'end'] },
  ];

  for (const { filters, ids } of cases) {
    const visibleEvents = filterAuditEvents(audit, filters);
    const displayedCount = visibleEvents.length;
    const csv = auditEventsToCsv(visibleEvents);
    const exportedRows = csv.slice(1).split('\r\n').filter(Boolean);

    assert.deepEqual(visibleEvents.map(event => event.id), ids);
    assert.equal(displayedCount, ids.length);
    assert.deepEqual(csv, auditEventsToCsv(audit.filter(event => ids.includes(event.id))));
    assert.equal(exportedRows.length - 1, displayedCount);
  }
});

test('journal date filters reject malformed dates instead of disabling the bound', () => {
  const events = [{ id: 'event', at: '2026-06-02T12:00:00.000Z', action: 'Événement', actor: 'Agent', scope: 'Messagerie', time: '13:00' }];
  for (const [from, to] of [
    ['2026-02-30', ''],
    ['', '2026-13-01'],
    ['02/06/2026', ''],
    ['', '2026-06-02-extra'],
  ]) {
    assert.throws(
      () => filterAuditEvents(events, { scope: 'Tous', query: '', from, to }),
      { name: 'RangeError', message: /date de (début|fin) est invalide/u },
    );
  }
  // Validate independently of the event collection, including when it is empty.
  assert.throws(
    () => filterAuditEvents([], { scope: 'Tous', query: '', from: 'invalid', to: '' }),
    { name: 'RangeError' },
  );
});

test('invalid journal dates show an error, match no events, and block CSV export', () => {
  const audit = [
    { id: 'matching', at: '2026-06-02T12:00:00.000Z', action: 'Événement correspondant', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
  ];
  const result = getAuditFilterResult(audit, {
    scope: 'Tous', query: '', from: '2026-02-30', to: '',
  });
  let downloadCount = 0;

  assert.equal(result.filterError, 'La date de début est invalide.');
  assert.deepEqual(result.events, []);
  assert.equal(AUDIT_EMPTY_STATE_MESSAGE, 'Aucun événement ne correspond à ces filtres.');
  assert.equal(hasAuditExportSelection(result.events), false);
  assert.equal(runAuditExport(result.events, () => { downloadCount += 1; }), undefined);
  assert.equal(downloadCount, 0);
});

test('correcting an invalid journal date restores matching events and CSV export', () => {
  const audit = [
    { id: 'matching', at: '2026-06-02T12:00:00.000Z', action: 'Événement correspondant', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
    { id: 'outside-range', at: '2026-06-03T12:00:00.000Z', action: 'Hors période', actor: 'Agent', scope: 'Messagerie', time: '13:00' },
  ];
  const invalidRanges = [
    { scope: 'Tous', query: '', from: '2026-02-30', to: '2026-06-02' },
    { scope: 'Tous', query: '', from: '2026-06-02', to: '2026-13-01' },
  ];
  const corrected = getAuditFilterResult(audit, {
    scope: 'Tous', query: '', from: '2026-06-02', to: '2026-06-02',
  });
  let downloadCount = 0;

  for (const filters of invalidRanges) {
    const invalid = getAuditFilterResult(audit, filters);
    assert.match(invalid.filterError, /^La date de (début|fin) est invalide\.$/u);
    assert.deepEqual(invalid.events, []);
    assert.equal(hasAuditExportSelection(invalid.events), false);
  }

  assert.equal(corrected.filterError, '');
  assert.deepEqual(corrected.events.map(event => event.id), ['matching']);
  assert.equal(hasAuditExportSelection(corrected.events), true);
  const csv = runAuditExport(corrected.events, () => {
    downloadCount += 1;
    return auditEventsToCsv(corrected.events);
  });
  assert.equal(downloadCount, 1);
  assert.match(csv, /Événement correspondant/u);
  assert.doesNotMatch(csv, /Hors période/u);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 2);
});

test('journal date filters reject a reversed date range', () => {
  assert.throws(
    () => filterAuditEvents([], {
      scope: 'Tous', query: '', from: '2026-06-03', to: '2026-06-02',
    }),
    { name: 'RangeError', message: 'La date de début doit être antérieure ou égale à la date de fin.' },
  );
});

test('journal without date bounds keeps historical events without timestamps', () => {
  const legacy = { id: 'legacy', action: 'Historique sans date', actor: 'Agent', scope: 'Messagerie', time: '10:00' };
  assert.deepEqual(filterAuditEvents([legacy], {
    scope: 'Tous', from: '', to: '', query: '',
  }), [legacy]);
});
