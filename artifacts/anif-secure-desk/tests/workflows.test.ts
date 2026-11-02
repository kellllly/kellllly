import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, parseLegacyTime } from '../src/lib/seed';
import { closeResolvedTicket, deriveNotifications, resolveTicket, withTicketEvent } from '../src/lib/domain';
import { readDemoStore, STORAGE_KEY, writeDemoStore } from '../src/lib/storage';
import { formatWAT } from '../src/lib/itsm';

function memoryStorage(entries: [string, string][] = [], full = false) {
  const entriesMap = new Map(entries);
  return {
    entriesMap,
    getItem(key: string) { return entriesMap.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (full) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      entriesMap.set(key, value);
    },
  };
}

test('migration preserves custom data and is idempotent across reloads', () => {
  const original = {
    profile: { name: 'Profil de test', role: 'Support IT', clearance: 'Technique' }, theme: 'dark',
    tickets: [{ id: 'REQ-9999', title: 'Ticket existant', description: 'Contenu conservé', priority: 'Élevée', status: 'Nouveau', createdAt: 'Hier, 10:30', updates: [] }],
    conversations: [{ id: 'C-custom', title: 'Discussion existante', participants: ['Profil de test'], unread: 1, messages: [{ id: 'msg', author: 'Profil de test', body: 'Contenu de test conservé.', time: '10:45' }] }],
    audit: [{ id: 'a', action: 'Action existante', actor: 'Test', scope: 'Test', time: 'Hier' }],
  };
  const once = migrate(original);
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assert.equal(once.profile.role, 'SSI / support');
  assert.equal(twice.theme, 'dark');
  assert.equal(twice.tickets.find(t => t.id === 'REQ-9999')?.description, 'Contenu conservé');
  assert.equal(twice.conversations.find(c => c.id === 'C-custom')?.messages[0]?.body, 'Contenu de test conservé.');
  assert.equal(twice.audit[0]?.action, 'Action existante');
  assert.equal(twice.conversations.filter(c => c.id === 'C-SUP').length, 1);
  assert.equal(once.tickets.length, twice.tickets.length);
  assert.deepEqual(once.tickets.map(t => t.openedAt), twice.tickets.map(t => t.openedAt));
});

test('legacy labels are interpreted in WAT, not the host timezone', () => {
  assert.equal(formatWAT(parseLegacyTime('Hier, 10:30'), 'time'), '10:30');
});

test('corrupt data is never overwritten even if backup storage is full', () => {
  const raw = '{broken-json';
  const storage = memoryStorage([[STORAGE_KEY, raw]], true);
  const loaded = readDemoStore(() => storage);
  assert.equal(loaded.writeBlocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(loaded.issue?.kind, 'load');
  assert.ok(loaded.issue?.message.includes('conservée sans modification'));
});

test('corrupt data does not replace an older readable backup', () => {
  const raw = '{corrupted-current-save';
  const previousBackup = '{"tickets":[{"id":"INC-PREVIOUS-BACKUP"}]}';
  const storage = memoryStorage([
    [STORAGE_KEY, raw],
    [`${STORAGE_KEY}-illisible`, previousBackup],
  ]);
  const loaded = readDemoStore(() => storage);
  assert.equal(loaded.writeBlocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(storage.getItem(`${STORAGE_KEY}-illisible`), previousBackup);
});

test('a quota failure keeps the last saved snapshot untouched', () => {
  const previous = JSON.stringify({ tickets: [{ id: 'INC-KEEP' }] });
  const storage = memoryStorage([[STORAGE_KEY, previous]], true);
  const issue = writeDemoStore(migrate(null), () => storage);
  assert.equal(issue?.kind, 'save');
  assert.ok(issue?.message.includes('saturé'));
  assert.equal(storage.getItem(STORAGE_KEY), previous);
});

test('invalid chronology and unexpected JSON shape enter protected recovery mode', () => {
  for (const raw of ['null', '[]', '{"tickets":"invalid"}', JSON.stringify({ tickets: [{ id: 'bad', openedAt: 'not-a-date' }] })]) {
    const storage = memoryStorage([[STORAGE_KEY, raw]]);
    const loaded = readDemoStore(() => storage);
    assert.equal(loaded.writeBlocked, true);
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

test('a valid saved schema loads without losing drafts or notifications', () => {
  const store = migrate(null);
  store.drafts['C-SUP'] = 'Brouillon de démonstration.';
  const storage = memoryStorage([[STORAGE_KEY, JSON.stringify(store)]]);
  const loaded = readDemoStore(() => storage);
  assert.equal(loaded.writeBlocked, false);
  assert.equal(loaded.store.drafts['C-SUP'], store.drafts['C-SUP']);
});

test('resolution requires documentation and an approved CAB for a change', () => {
  let store = migrate(null);
  const change = store.tickets.find(t => t.kind === 'Changement')!;
  assert.throws(() => resolveTicket(store, change.id, 'Cause documentée', 'Solution documentée'));
  store = withTicketEvent(store, change.id, 'Approbation simulée', {
    status: 'En cours', acknowledgedAt: new Date().toISOString(),
    cab: { decision: 'Approuvé', at: new Date().toISOString(), by: 'Test', reason: 'Test approuvé' },
  });
  assert.throws(() => resolveTicket(store, change.id, 'court', 'court'));
  const next = resolveTicket(store, change.id, 'Cause technique documentée.', 'Solution technique documentée.');
  assert.equal(next.tickets.find(t => t.id === change.id)?.status, 'Résolu');
});

test('requester confirmation creates one KEDB article, once, and mirrors the linked thread', () => {
  let store = migrate(null);
  const ticket = store.tickets.find(t => t.status === 'En cours' && t.kind === 'Incident')!;
  store = withTicketEvent(store, ticket.id, 'Discussion liée', { conversationId: 'C-SUP' });
  assert.throws(() => closeResolvedTicket(store, ticket.id));
  store = resolveTicket(store, ticket.id, 'Cause technique de test.', 'Correction de test appliquée.');
  const resolvedAt = store.tickets.find(t => t.id === ticket.id)!.resolvedAt;
  store = closeResolvedTicket(store, ticket.id);
  assert.equal(store.tickets.find(t => t.id === ticket.id)?.status, 'Clos');
  assert.equal(store.tickets.find(t => t.id === ticket.id)?.resolvedAt, resolvedAt);
  assert.equal(store.kedb.filter(a => a.ticketId === ticket.id).length, 1);
  assert.ok(store.conversations.find(c => c.id === 'C-SUP')?.messages.some(m => m.ticketId === ticket.id && m.body.includes('Ticket clos')));
  assert.equal(closeResolvedTicket(store, ticket.id), store);
});

test('ticket comments and status events stay linked to their conversation', () => {
  let store = migrate(null);
  const ticket = store.tickets.find(t => t.status === 'En cours' && t.kind === 'Incident')!;
  store = withTicketEvent(store, ticket.id, 'Discussion liée', { conversationId: 'C-SUP' });
  const comment = 'Vérification technique ajoutée au suivi.';
  store = withTicketEvent(store, ticket.id, comment, {}, 'Analyste de test', true);
  const conversation = store.conversations.find(c => c.id === 'C-SUP')!;
  const mirroredComment = conversation.messages.at(-1)!;
  assert.equal(mirroredComment.ticketId, ticket.id);
  assert.equal(mirroredComment.author, 'Analyste de test');
  assert.equal(mirroredComment.system, false);
  assert.equal(mirroredComment.body, `Commentaire sur ${ticket.id} : ${comment}`);

  store = withTicketEvent(store, ticket.id, 'Qualification conservée.', { supportLevel: 2 });
  assert.equal(store.tickets.find(t => t.id === ticket.id)?.openedAt, ticket.openedAt);
  assert.equal(store.conversations.find(c => c.id === 'C-SUP')?.messages.at(-1)?.ticketId, ticket.id);
});

test('notifications follow active SLA state and honor locally read identifiers', () => {
  const store = migrate(null);
  const now = Date.now() + 24 * 60 * 60 * 1000;
  const notifications = deriveNotifications(store, now);
  assert.ok(notifications.length > 0);
  const first = notifications[0]!;
  store.notifRead.push(first.id);
  assert.equal(deriveNotifications(store, now).find(n => n.id === first.id)?.read, true);
});
