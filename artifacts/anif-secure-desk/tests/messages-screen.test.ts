/**
 * Tests de l'écran Messagerie : la vraie page React dans jsdom, avec l'API, le
 * store, l'annuaire et le routeur remplacés par des doublures (tests/components).
 * Les règles (pièces jointes, données sensibles, conversion, canaux) restent celles de src/lib.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, loadComponents } from './components/harness.ts';

const dom = installDom();
test.after(() => dom.window.close());
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await loadComponents();

const roots: Array<() => Promise<void>> = [];
test.afterEach(async () => { while (roots.length) await roots.pop()!(); });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const message = (id: string, author: string, body: string, extra: Record<string, unknown> = {}) => ({ id, author, body, time: '', at: at(30), ...extra });
function conversations() {
  return [
    { id: 'C-SUP', title: 'Support informatique', kind: 'Support', classification: 'Interne', participants: ['Support'], readCount: 1, messages: [
      message('m1', 'user_agent', 'Le VPN coupe toutes les 5 minutes depuis ce matin. Merci de regarder.', { isInstruction: false }),
      message('m2', 'Support', 'Redémarrez le poste avant tout nouveau signalement.', { isInstruction: true }),
    ] },
    { id: 'C-GRP', title: 'Équipe réseau', kind: 'Groupe', classification: 'Interne', participants: ['user_me', 'Équipe'], readCount: 0, messages: [message('g1', 'user_agent', 'Point d’équipe à 10 h.')] },
    { id: 'C-ANN', title: 'Annonces générales', kind: 'Annonce', classification: 'Interne', participants: ['Direction'], readCount: 1, messages: [message('a1', 'Direction', 'Fermeture des bureaux vendredi.', { system: true })] },
    { id: 'C-TMP', title: 'Mission d’audit', kind: 'Temporaire', classification: 'Restreint', participants: ['user_me', 'user_auditor'], memberIds: ['user_me', 'user_auditor'], readCount: 1, durationHours: 24, expiresAt: at(60), messages: [message('t1', 'user_auditor', 'Pièces reçues.')] },
  ];
}

async function mountMessages({ clearance = 'N2 · Interne', search = '', extra = [] as Array<Record<string, unknown>> } = {}) {
  ui.calls.length = 0;
  ui.logs.length = 0;
  ui.resyncs.count = 0;
  ui.router.path = '/messages';
  ui.router.search = search;
  ui.router.history.length = 0;
  ui.clock.now = Date.now();
  ui.handlers.getItsmWorkspaceVersion = async () => ({ version: 7 });
  const store = ui.testStore([], [...conversations(), ...extra]);
  store.profile = { ...store.profile, name: 'user_me', clearance };
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ui.QueryClientProvider, { client }, createElement(ui.TestStoreProvider, { initial: store }, createElement(ui.MessagesPage))));
  });
  await settle();
  roots.push(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
}

const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const conversation = (id: string) => (ui.current.store!.conversations as Array<Record<string, any>>).find((c) => c.id === id)!;
const text = () => document.body.textContent ?? '';
async function click(id: string) {
  const element = $(id);
  assert.ok(element, `${id} présent`);
  assert.equal((element as HTMLButtonElement).disabled ?? false, false, `${id} actif`);
  await act(async () => { element!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}
async function fill(id: string, value: string) {
  const element = $(id);
  assert.ok(element, `${id} présent`);
  const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype
    : element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  await act(async () => { element!.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function submitForm(id: string) {
  const form = $(id)?.closest('form');
  assert.ok(form, `formulaire de ${id}`);
  await act(async () => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
}
async function attach(name: string, type: string, content = 'contenu') {
  const input = $('input-attachment') as HTMLInputElement;
  const file = new dom.window.File([content], name, { type });
  // jsdom's File has no arrayBuffer(): read the same bytes through Node's Blob.
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Blob([content]).arrayBuffer() });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await settle();
}
const openConversation = (id: string) => click(`row-conversation-${id}`);

test('canal support : seul un signalement se convertit ; les données nominatives bloquent ; l’incident est lié au fil', async () => {
  await mountMessages();
  assert.ok($('button-convert-m1'), 'un signalement est convertible');
  assert.equal($('button-convert-m2'), null, 'une consigne ne l’est pas');
  await click('filter-support-messages-instruction');
  assert.equal($('button-convert-m1'), null);
  assert.match($('list-messages')!.textContent!, /Redémarrez le poste/u);
  await click('filter-support-messages-all');

  await click('button-convert-m1');
  await settle();
  assert.equal(($('input-convert-title') as HTMLInputElement).value, 'Le VPN coupe toutes les 5 minutes depuis ce matin', 'sujet tiré de la première phrase');
  assert.match($('conversion-source-message')!.textContent!, /MESSAGE SOURCE · m1/u);
  assert.match($('conversion-environment')!.textContent!, /ANIF Secure Desk \(test\)/u, 'environnement relevé');
  assert.ok(ui.calls.some((entry: { name: string }) => entry.name === 'getItsmWorkspaceVersion'), 'latence mesurée sur l’API');

  await fill('input-convert-summary', 'Contact : jean.obame@example.ga, IBAN FR7630006000011234567890189.');
  assert.ok($('alert-sensitive-data'), 'données détectées');
  await click('checkbox-no-sensitive');
  assert.equal(($('button-submit-convert') as HTMLButtonElement).disabled, true, 'la création reste bloquée');
  await fill('input-convert-summary', 'Coupures VPN toutes les 5 minutes sur le site de Libreville.');
  assert.equal($('alert-sensitive-data'), null);
  await submitForm('button-submit-convert');

  const [ticket] = ui.current.store!.tickets as Array<Record<string, any>>;
  assert.equal(ticket!.id, 'INC-2401');
  assert.equal(ticket!.sourceMessageId, 'm1');
  assert.equal(ticket!.conversationId, 'C-SUP');
  assert.equal(ticket!.priority, 'P3', 'impact et urgence moyens par défaut');
  assert.match(ticket!.description, /Coupures VPN/u);
  assert.match(ticket!.description, /ANIF Secure Desk \(test\)/u, 'l’environnement est joint au ticket');
  assert.equal(ui.current.store!.notifications[0]!.title, 'Incident INC-2401 créé depuis le canal support');
  assert.equal(conversation('C-SUP').messages.at(-1).body, 'Incident INC-2401 ouvert en P3 à partir d’un message du canal.');
  assert.ok($('side-ticket-INC-2401'), 'le ticket apparaît à côté du fil');
  assert.ok($('button-linked-m1'), 'le message pointe vers son ticket');
  assert.equal($('button-convert-m1'), null, 'pas de seconde conversion');

  await fill('input-side-comment', 'Relais VPN redémarré.');
  await submitForm('input-side-comment');
  assert.equal((ui.current.store!.tickets[0] as Record<string, any>).updates.at(-1).body, 'Relais VPN redémarré.');
});

test('envoi d’un message éphémère, brouillon effacé, et marquage lu / non lu', async () => {
  await mountMessages();
  assert.ok(document.querySelector('[data-testid="page-intro"]'), 'la Messagerie utilise le gabarit d’en-tête partagé');
  assert.ok($('badge-unread-C-GRP'), 'la conversation de groupe a un message non lu');
  await openConversation('C-GRP');
  assert.equal($('badge-unread-C-GRP'), null, 'ouvrir la conversation la marque lue');
  await fill('select-message-ttl', '30');
  await fill('input-message', '  Je prends le point réseau.  ');
  assert.equal(ui.current.store!.drafts['C-GRP'], '  Je prends le point réseau.  ', 'le brouillon est gardé par conversation');
  await submitForm('button-send');
  const sent = conversation('C-GRP').messages.at(-1);
  assert.deepEqual([sent.author, sent.body, sent.ttlSeconds], ['user_me', 'Je prends le point réseau.', 30]);
  assert.equal(ui.current.store!.drafts['C-GRP'], undefined);
  assert.equal(ui.logs.at(-1)!.action, 'Message envoyé dans la conversation C-GRP');

  await click('button-toggle-read');
  assert.equal(conversation('C-GRP').readCount, conversation('C-GRP').messages.length - 1, 'marquée non lue');
  await click('button-toggle-read');
  assert.equal(conversation('C-GRP').readCount, conversation('C-GRP').messages.length);
});

test('pièces jointes : un exécutable est refusé, une archive exige un accusé, seule la description est envoyée', async () => {
  await mountMessages();
  await openConversation('C-GRP');
  await attach('facture.pdf.exe', 'application/octet-stream');
  assert.match($('attachment-blocked')!.textContent!, /Fichier exécutable ou script \(\.exe\)/u);
  await submitForm('button-send');
  assert.equal(conversation('C-GRP').messages.length, 1, 'rien n’est envoyé');
  await click('button-remove-attachment');
  assert.equal($('panel-attachment'), null);

  await attach('releves.zip', 'application/zip', 'PK…');
  assert.match($('attachment-warning')!.textContent!, /Archive compressée/u);
  await submitForm('button-send');
  assert.equal(conversation('C-GRP').messages.length, 1, 'l’avertissement doit être accepté');
  await click('checkbox-attachment-ack');
  await submitForm('button-send');
  const sent = conversation('C-GRP').messages.at(-1);
  assert.equal(sent.body, 'Pièce jointe : releves.zip');
  assert.deepEqual([sent.attachment.name, sent.attachment.type, sent.attachment.acknowledged], ['releves.zip', 'application/zip', true]);
  assert.match(sent.attachment.sha256, /^[0-9a-f]{64}$/u, 'empreinte SHA-256 du contenu');
  assert.equal('content' in sent.attachment, false, 'jamais le contenu');
});

test('les annonces sont en lecture seule hors N1, et un canal temporaire clos refuse les messages', async () => {
  await mountMessages();
  await openConversation('C-ANN');
  assert.ok($('banner-announcement'));
  assert.ok($('text-announcement-readonly'));
  await fill('input-message', 'Question sur la fermeture');
  await submitForm('button-send');
  assert.equal(conversation('C-ANN').messages.length, 1, 'un N2 ne publie pas d’annonce');

  await openConversation('C-TMP');
  assert.ok($('banner-temporary'));
  assert.ok($('text-channel-closed'));
  await fill('input-message', 'Encore une pièce');
  await submitForm('button-send');
  assert.equal(conversation('C-TMP').messages.length, 1, 'canal clos');
});

test('un N1 publie dans les annonces', async () => {
  await mountMessages({ clearance: 'N1 · Direction' });
  await openConversation('C-ANN');
  assert.equal($('text-announcement-readonly'), null);
  await fill('input-message', 'Rappel : mise à jour des postes lundi.');
  await submitForm('button-send');
  assert.equal(conversation('C-ANN').messages.at(-1).body, 'Rappel : mise à jour des postes lundi.');
});

test('un auditeur N5 écrit par l’API dédiée, puis l’espace est rechargé ; un refus est affiché', async () => {
  await mountMessages({ clearance: 'N5 · Audit' });
  assert.equal($('button-new-conversation'), null, 'un auditeur ne crée pas de conversation');
  await openConversation('C-GRP');
  assert.equal($('select-message-ttl'), null, 'pas de message éphémère');
  assert.equal($('input-attachment'), null, 'pas de pièce jointe');
  ui.handlers.postItsmTemporaryMessage = async () => ({ ok: true });
  await fill('input-message', '  Constat transmis.  ');
  await submitForm('button-send');
  const posted = ui.calls.find((entry: { name: string }) => entry.name === 'postItsmTemporaryMessage');
  assert.deepEqual(posted!.args, ['C-GRP', { body: 'Constat transmis.' }]);
  assert.equal(conversation('C-GRP').messages.length, 1, 'le message vient du serveur, pas du navigateur');
  assert.equal(ui.resyncs.count, 1);
  assert.equal(ui.current.store!.drafts['C-GRP'], undefined);

  ui.handlers.postItsmTemporaryMessage = async () => { throw new Error('Ce canal temporaire n’est pas accessible.'); };
  await fill('input-message', 'Second constat');
  await submitForm('button-send');
  assert.match(text(), /Ce canal temporaire n’est pas accessible\./u);
});

test('nouvelle conversation de groupe, puis échange bilatéral sans doublon', async () => {
  await mountMessages();
  await click('button-new-conversation');
  await fill('input-conversation-title', 'Migration messagerie');
  await submitForm('button-submit-conversation');
  const [created] = ui.current.store!.conversations as Array<Record<string, any>>;
  assert.deepEqual([created!.title, created!.kind, created!.classification], ['Migration messagerie', 'Groupe', 'Interne']);
  assert.match(created!.id, /^C-[0-9A-F]{8}$/u);

  ui.handlers.getItsmContacts = async () => ({ contacts: [{ userId: 'user_peer', name: 'Olivier Nguema', role: 'N3' }] });
  await click('button-new-conversation');
  await fill('select-conversation-kind', 'Direct');
  await settle();
  assert.equal(($('button-submit-conversation') as HTMLButtonElement).disabled, true, 'un collègue doit être choisi');
  await click('input-contact-user_peer');
  await submitForm('button-submit-conversation');
  const direct = (ui.current.store!.conversations as Array<Record<string, any>>)[0]!;
  assert.deepEqual([direct.kind, direct.classification, direct.memberIds], ['Direct', 'Confidentiel', ['user_me', 'user_peer']]);
  assert.ok($('banner-direct'));
  const count = ui.current.store!.conversations.length;

  await click('button-new-conversation');
  await fill('select-conversation-kind', 'Direct');
  await settle();
  await click('input-contact-user_peer');
  await submitForm('button-submit-conversation');
  assert.equal(ui.current.store!.conversations.length, count, 'l’échange existant est rouvert');
});

test('recherche, filtre par type et lien vers un message disparu', async () => {
  await mountMessages({ search: 'c=C-SUP&m=m-absent' });
  assert.ok($('text-source-message-unavailable'), 'le message source n’existe plus');
  assert.deepEqual(ui.router.history, ['/messages'], 'l’adresse est nettoyée');
  const rows = () => [...document.querySelectorAll('[data-testid^="row-conversation-"]')].map((row) => (row as HTMLElement).dataset.testid);
  await fill('input-search-messages', 'vpn');
  assert.deepEqual(rows(), ['row-conversation-C-SUP'], 'recherche dans le contenu des messages');
  await fill('input-search-messages', '');
  await click('filter-conv-Temporaire');
  assert.deepEqual(rows(), ['row-conversation-C-TMP']);
  await click('filter-conv-Toutes');
  assert.equal(rows().length, 4);
});

test('l’auteur corrige un message pendant 5 minutes et le supprime ensuite, par l’API ; les autres messages restent intouchables', async () => {
  const mineRoom = { id: 'C-MINE', title: 'Mes échanges', kind: 'Équipe', classification: 'Interne', participants: ['user_me'], readCount: 5, messages: [
    message('e1', 'user_me', 'Réunion à 10 h', { at: at(1) }),
    message('e2', 'user_me', 'Ancien message', { at: at(30) }),
    message('e3', 'user_me', 'Texte corrigé', { at: at(40), editedAt: at(38), revisions: [{ body: 'Texte initial', at: at(40) }] }),
    message('e4', 'user_me', '', { deleted: true, deletedAt: at(20) }),
    message('e5', 'user_agent', 'Message d’un collègue', { at: at(1) }),
  ] };
  await mountMessages({ extra: [mineRoom] });
  await openConversation('C-MINE');
  assert.ok($('button-edit-message-e1'), 'message récent : modifiable');
  assert.equal($('button-edit-message-e2'), null, 'plus de 5 minutes : plus modifiable');
  assert.ok($('button-delete-message-e2'), 'mais toujours supprimable');
  assert.equal($('button-delete-message-e5'), null, 'pas d’action sur le message d’un autre');
  assert.equal($('button-delete-message-e4'), null, 'un message supprimé n’a plus d’action');
  assert.match($('message-deleted-e4')!.textContent!, /Message supprimé par son auteur/u);
  assert.match($('message-edited-e3')!.textContent!, /Modifié.*Texte initial/su);

  ui.handlers.editItsmMessage = async () => ({ revised: true });
  await click('button-edit-message-e1');
  assert.equal(($('button-confirm-revision') as HTMLButtonElement).disabled, true, 'texte inchangé : rien à enregistrer');
  await fill('input-edit-message', ' Réunion à 11 h ');
  await click('button-confirm-revision');
  await settle();
  assert.deepEqual(ui.calls.find((entry: { name: string }) => entry.name === 'editItsmMessage')!.args, ['C-MINE', 'e1', { body: 'Réunion à 11 h' }]);
  assert.equal(ui.resyncs.count, 1, 'l’espace est rechargé depuis le serveur');
  assert.equal($('input-edit-message'), null);
  assert.equal(conversation('C-MINE').messages[0].body, 'Réunion à 10 h', 'le navigateur ne réécrit pas l’historique lui-même');

  ui.handlers.deleteItsmMessage = async () => { throw new Error('Le délai est dépassé.'); };
  await click('button-delete-message-e2');
  await click('button-confirm-revision');
  await settle();
  assert.match(text(), /Le délai est dépassé\./u, 'le refus du serveur est affiché');
  ui.handlers.deleteItsmMessage = async () => ({ revised: true });
  await click('button-confirm-revision');
  await settle();
  assert.deepEqual(ui.calls.filter((entry: { name: string }) => entry.name === 'deleteItsmMessage').at(-1)!.args, ['C-MINE', 'e2']);
  assert.equal(ui.resyncs.count, 2);
});

test('répondre à un message le cite au-dessus de la réponse ; la citation suit l’état du message d’origine', async () => {
  const room = { id: 'C-REP', title: 'Réponses', kind: 'Équipe', classification: 'Interne', participants: ['user_me'], readCount: 3, messages: [
    message('r1', 'user_agent', 'Le serveur de fichiers redémarre à 18 h.'),
    message('r2', 'user_agent', '', { deleted: true }),
    message('r3', 'user_me', 'Bien noté', { replyToId: 'r2' }),
  ] };
  await mountMessages({ extra: [room] });
  await openConversation('C-REP');
  assert.match($('message-quote-r3')!.textContent!, /Message supprimé par son auteur/u, 'un message cité puis supprimé n’est plus affiché');
  assert.equal($('button-reply-r2'), null, 'on ne répond pas à un message supprimé');
  await click('button-reply-r1');
  assert.match($('panel-reply')!.textContent!, /Le serveur de fichiers redémarre/u);
  await click('button-cancel-reply');
  assert.equal($('panel-reply'), null);
  await click('button-reply-r1');
  await fill('input-message', 'Je préviens l’équipe.');
  await submitForm('button-send');
  const sent = conversation('C-REP').messages.at(-1);
  assert.deepEqual([sent.body, sent.replyToId], ['Je préviens l’équipe.', 'r1']);
  assert.equal($('panel-reply'), null, 'la réponse envoyée, la citation disparaît du champ de saisie');
  assert.match($(`message-quote-${sent.id}`)!.textContent!, /Le serveur de fichiers redémarre à 18 h\./u);
});

test('épingler un message l’affiche en tête de conversation ; cinq au plus, et on peut le désépingler', async () => {
  const room = { id: 'C-PIN', title: 'Épingles', kind: 'Équipe', classification: 'Interne', participants: ['user_me'], readCount: 7, pinnedIds: ['p1', 'p2', 'p3', 'p4'], messages: [
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(id => message(id, 'user_agent', `Consigne ${id}`)),
    message('p7', 'user_agent', '', { deleted: true }),
  ] };
  await mountMessages({ extra: [room] });
  await openConversation('C-PIN');
  assert.match($('panel-pinned')!.textContent!, /4\/5.*Consigne p1.*Consigne p4/su);
  assert.equal($('button-pin-p7'), null, 'un message supprimé ne s’épingle pas');
  await click('button-pin-p5');
  assert.deepEqual(conversation('C-PIN').pinnedIds, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(ui.logs.at(-1)!.action, 'Message épinglé dans la conversation C-PIN');
  assert.equal($('button-pin-p6'), null, 'cinq épingles : plus d’ajout possible');
  assert.equal($('button-pin-p1')!.getAttribute('aria-pressed'), 'true');
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) await click(`button-pin-${id}`);
  assert.equal('pinnedIds' in conversation('C-PIN'), false, 'plus d’épingle : la clé disparaît');
  assert.equal($('panel-pinned'), null);
});
