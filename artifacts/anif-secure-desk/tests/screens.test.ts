/**
 * Tests des écrans métier (file des tickets) : la vraie page React dans jsdom,
 * avec le store, l'annuaire et le routeur remplacés par des doublures locales
 * (tests/components/*-stub). Les règles ITIL restent celles de src/lib/domain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, loadComponents } from './components/harness.ts';

const dom = installDom();
// The dialogs leave jsdom timers behind: close the window so the process can end.
test.after(() => dom.window.close());
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await loadComponents();

const roots: Array<() => Promise<void>> = [];
async function mountTickets(search = '', initial = ui.testStore()) {
  ui.router.path = '/tickets';
  ui.router.search = search;
  ui.router.history.length = 0;
  ui.logs.length = 0;
  ui.clock.now = Date.now();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(ui.TestStoreProvider, { initial }, createElement(ui.TicketsPage))); });
  roots.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}
test.afterEach(async () => { while (roots.length) await roots.pop()!(); });

/** Dialogs are rendered in a portal: search the whole document. */
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tickets = () => ui.current.store!.tickets as Array<Record<string, any>>;
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
async function submitForm(buttonId: string) {
  const form = $(buttonId)?.closest('form');
  assert.ok(form, `formulaire de ${buttonId}`);
  await act(async () => { form!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
}
async function createTicket(fields: Record<string, string>) {
  await click('button-create-ticket');
  for (const [id, value] of Object.entries(fields)) await fill(id, value);
  await submitForm('button-submit-ticket');
}
const actionsShown = () => [...document.querySelectorAll('[data-testid="panel-ticket-detail"] [data-testid^="button-"]')]
  .map((element) => (element as HTMLElement).dataset.testid).sort();

test('un incident suit tout son cycle : création, prise en charge, attente, escalade, résolution documentée et clôture KEDB', async () => {
  await mountTickets();
  assert.ok(document.querySelector('.td-heading'), 'la page Tickets suit le gabarit de titre commun');
  assert.match(document.body.textContent ?? '', /Aucun ticket pour cette sélection/u);

  await createTicket({ 'select-kind': 'Incident', 'input-title': 'Messagerie inaccessible au 3e étage', 'select-impact': '1', 'select-urgency': '2', 'input-description': 'Plusieurs postes signalent une erreur de connexion.' });
  assert.equal($('button-submit-ticket'), null, 'la fenêtre de création est fermée');
  const [created] = tickets();
  assert.deepEqual([created!.id, created!.kind, created!.priority, created!.status], ['INC-2401', 'Incident', 'P2', 'Nouveau'], 'impact fort × urgence moyenne = P2');
  assert.equal(ui.logs.at(-1)!.action, 'Ticket INC-2401 créé (Incident, P2)');
  assert.ok($('row-ticket-INC-2401'));
  assert.deepEqual(actionsShown(), ['button-ack', 'button-edit-ticket', 'button-escalate', 'button-ticket-comment'], 'pas de résolution avant la prise en charge');

  await click('button-ack');
  assert.equal(tickets()[0]!.status, 'Pris en compte');
  assert.ok(tickets()[0]!.acknowledgedAt, 'heure de prise en charge enregistrée');
  await click('button-start');
  await click('button-hold');
  assert.equal(tickets()[0]!.status, 'En attente');
  await click('button-start');
  assert.equal(tickets()[0]!.status, 'En cours');
  await click('button-escalate');
  assert.equal(tickets()[0]!.supportLevel, 2);
  assert.equal(ui.current.store!.notifications[0]!.title, 'Escalade L2 · INC-2401');

  await fill('input-ticket-comment', '  Redémarrage du relais SMTP planifié.  ');
  await submitForm('input-ticket-comment');
  assert.equal(tickets()[0]!.updates.at(-1).body, 'Redémarrage du relais SMTP planifié.');
  assert.equal(($('input-ticket-comment') as HTMLInputElement).value, '', 'le champ est vidé');

  await click('button-resolve');
  await fill('input-root-cause', 'Trop court');
  await fill('input-resolution', 'Relais SMTP redémarré et file vidée.');
  assert.equal(($('button-submit-resolve') as HTMLButtonElement).disabled, false, '10 caractères suffisent');
  await fill('input-root-cause', 'court');
  assert.equal(($('button-submit-resolve') as HTMLButtonElement).disabled, true, 'une cause racine trop courte bloque la résolution');
  await fill('input-root-cause', 'Certificat du relais SMTP expiré.');
  await submitForm('button-submit-resolve');
  assert.equal(tickets()[0]!.status, 'Résolu');
  assert.equal(tickets()[0]!.rootCause, 'Certificat du relais SMTP expiré.');

  await click('button-confirm-close');
  assert.equal(($('button-submit-close') as HTMLButtonElement).disabled, true, 'la confirmation du demandeur est exigée');
  await click('checkbox-confirm-requester');
  await click('radio-satisfaction-4');
  assert.match(document.body.textContent!, /4\/5 · Satisfait/u);
  await click('button-submit-close');
  assert.equal(tickets()[0]!.status, 'Clos');
  assert.equal(tickets()[0]!.satisfaction, 4, 'note transmise avec la clôture');
  assert.equal(ui.current.store!.kedb.length, 1);
  assert.equal(ui.current.store!.kedb[0]!.ticketId, 'INC-2401');
  // Un ticket clos sort de la vue « Ouverts » : on l'affiche avec le filtre « Tous ».
  await fill('filter-état', 'Tous');
  assert.ok($('link-kedb'), 'lien vers l’article KEDB');
  assert.deepEqual(actionsShown(), [], 'aucune action sur un ticket clos');
});

test('un ticket résolu peut être rouvert, et la modification recalcule la priorité sans remettre l’horloge à zéro', async () => {
  await mountTickets();
  await createTicket({ 'input-title': 'Imprimante du 2e étage hors ligne', 'select-impact': '3', 'select-urgency': '3' });
  const openedAt = tickets()[0]!.openedAt;
  assert.equal(tickets()[0]!.priority, 'P4');
  await click('button-edit-ticket');
  await fill('select-impact', '1');
  await fill('select-urgency', '1');
  await submitForm('button-submit-ticket');
  assert.equal(tickets()[0]!.priority, 'P1');
  assert.equal(tickets()[0]!.openedAt, openedAt, 'l’ouverture est conservée');
  assert.match(tickets()[0]!.updates.at(-1).body, /priorité recalculée P4 vers P1/u);

  await click('button-ack');
  await click('button-resolve');
  await fill('input-root-cause', 'Bourrage papier sur le bac 2.');
  await fill('input-resolution', 'Bac nettoyé et imprimante relancée.');
  await submitForm('button-submit-resolve');
  await click('button-reopen');
  assert.equal(tickets()[0]!.status, 'En cours');
  assert.equal(tickets()[0]!.resolvedAt, null);
});

test('un changement exige une décision CAB : démarrage bloqué, rejet motivé obligatoire, approbation qui débloque', async () => {
  await mountTickets();
  await createTicket({ 'select-kind': 'Changement', 'input-title': 'Mise à jour du pare-feu de Nkok' });
  const id = tickets()[0]!.id;
  assert.match(id, /^CHG-/u);
  await click('button-ack');
  assert.equal(($('button-start') as HTMLButtonElement).disabled, true, 'démarrage bloqué sans CAB');
  assert.equal($('button-resolve'), null, 'résolution impossible sans CAB');
  assert.match($('panel-ticket-detail')!.textContent ?? '', /bloqués tant qu’aucune approbation CAB/u);

  await click('button-cab');
  assert.equal(($('button-cab-reject') as HTMLButtonElement).disabled, true, 'un rejet doit être motivé');
  await fill('input-cab-reason', 'Fenêtre validée, retour arrière testé.');
  await click('button-cab-approve');
  assert.equal(tickets()[0]!.cab.decision, 'Approuvé');
  assert.equal(ui.logs.at(-1)!.action, `Changement ${id} approuvé par le CAB simulé`);
  await click('button-start');
  assert.equal(tickets()[0]!.status, 'En cours');
  assert.ok($('button-resolve'));
});

test('un changement rejeté est clos avec son motif', async () => {
  await mountTickets();
  await createTicket({ 'select-kind': 'Changement', 'input-title': 'Migration de l’annuaire' });
  await click('button-cab');
  await fill('input-cab-reason', 'Pas de plan de retour arrière.');
  await click('button-cab-reject');
  const [rejected] = tickets();
  assert.equal(rejected!.status, 'Rejeté');
  assert.ok(rejected!.closedAt);
  assert.match(rejected!.updates.at(-1).body, /rejeté\. Motif : Pas de plan de retour arrière\./u);
});

test('recherche et filtres : résultats, ticket actif masqué, réinitialisation', async () => {
  await mountTickets();
  await createTicket({ 'input-title': 'VPN instable', 'select-impact': '1', 'select-urgency': '1' });
  await createTicket({ 'select-kind': 'Demande', 'input-title': 'Nouveau badge d’accès', 'select-impact': '3', 'select-urgency': '3' });
  const rows = () => [...document.querySelectorAll('[data-testid^="row-ticket-"]')].map((row) => (row as HTMLElement).dataset.testid);
  assert.deepEqual(rows(), ['row-ticket-INC-2401', 'row-ticket-REQ-2402'], 'P1 avant P4');

  await fill('input-search-tickets', 'badge');
  assert.deepEqual(rows(), ['row-ticket-REQ-2402']);
  await fill('input-search-tickets', '');
  await fill('filter-priorité', 'P1');
  assert.deepEqual(rows(), ['row-ticket-INC-2401']);
  assert.match(document.body.textContent ?? '', /Le ticket REQ-2402 est masqué par les filtres actuels/u, 'le ticket créé en dernier reste signalé');
  await fill('filter-type', 'Demande');
  assert.deepEqual(rows(), []);
  assert.match(document.body.textContent ?? '', /Aucune sélection/u);
  await click('button-reset-filters');
  assert.equal(rows().length, 2);
  assert.equal($('button-reset-filters'), null, 'le bouton disparaît sans filtre');
});

test('un lien du catalogue ouvre la création préremplie, puis nettoie l’adresse', async () => {
  await mountTickets('new=1&service=SVC-02');
  assert.equal(($('input-title') as HTMLInputElement).value, 'Demande — Portail de services');
  assert.equal(($('select-kind') as HTMLSelectElement).value, 'Demande');
  assert.equal(($('select-service') as HTMLSelectElement).value, 'SVC-02');
  assert.deepEqual(ui.router.history, ['/tickets']);
  await click('button-cancel-ticket');
  assert.equal($('input-title'), null);
  assert.equal(tickets().length, 0, 'annuler ne crée rien');
});

test('un lien d’équipement préremplit un incident avec la catégorie du matériel', async () => {
  await mountTickets('new=1&asset=MAT-0527');
  assert.equal(($('input-title') as HTMLInputElement).value, 'Incident — Point d’accès — aile Est (MAT-0527)');
  assert.equal(($('select-category') as HTMLSelectElement).value, 'Réseau');
  assert.match(($('input-description') as HTMLTextAreaElement).value, /^Équipement MAT-0527 · Réseau · Libreville · Bâtiment A\./u);
});

// ---------------------------------------------------------------------------
// Préférences : administration des habilitations (N1), réauthentification Clerk.

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, Array<() => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) { this.url = url; FakeEventSource.last = this; }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close() { this.closed = true; }
  async emit(type: string) {
    await act(async () => { if (type === 'open') this.onopen?.(); else if (type === 'error') this.onerror?.(); else this.listeners.get(type)?.forEach((listener) => listener()); });
  }
}
(globalThis as Record<string, unknown>).EventSource = FakeEventSource;

const accounts = [
  { userId: 'user_n1', email: 'n1@example.test', role: 'N1', serviceIds: [], unavailableServiceIds: [] },
  { userId: 'user_agent', email: 'agent@example.test', role: 'N2', serviceIds: [], unavailableServiceIds: [] },
  { userId: 'user_appui', email: 'appui@example.test', role: 'N4', serviceIds: ['SVC-01', 'SVC-99'], unavailableServiceIds: ['SVC-99'] },
];
const confirmAnswers: boolean[] = [];
const confirmations: string[] = [];
window.confirm = (message?: string) => { confirmations.push(String(message)); return confirmAnswers.shift() ?? true; };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const callsTo = (name: string) => ui.calls.filter((entry: { name: string }) => entry.name === name);
const workspace = (services: Array<{ id: string; name: string }>) => ({ version: 3, store: { services } });
const hint = { data: { clerk_error: { type: 'forbidden', reason: 'reverification-error' } }, status: 403 };

async function mountSettings(clearance: string) {
  ui.calls.length = 0;
  ui.clerk.dialogs = 0;
  ui.clerk.reverify = 'success';
  confirmAnswers.length = 0;
  confirmations.length = 0;
  FakeEventSource.last = null;
  const store = ui.testStore();
  store.profile = { ...store.profile, name: 'user_n1', clearance };
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ui.QueryClientProvider, { client },
      createElement(ui.TestStoreProvider, { initial: store }, createElement(ui.SettingsPage))));
  });
  await settle();
  roots.push(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
  lastClient = client;
  return container;
}
async function mountWatermark() {
  ui.handlers.getItsmSessionMarker = async () => ({
    accountId: 'user_n1',
    ip: '127.0.0.1',
    serverTime: '2026-11-11T10:00:00.000Z',
  });
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ui.QueryClientProvider, { client },
      createElement(ui.TestStoreProvider, { initial: ui.testStore() },
        createElement(ui.Watermark, { name: 'Compte de test' }))));
  });
  roots.push(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
  await settle();
  return container;
}
let lastClient: any = null;
/** Directory data still held in the React Query cache (e-mails, roles). */
const cachedDirectories = () => lastClient.getQueryCache().findAll({ queryKey: ['/api/itsm/users'] }).filter((query: any) => query.state.data !== undefined);
function defaultHandlers() {
  ui.handlers.getItsmUserDirectory = async () => ({ accounts, totalCount: accounts.length, offset: 0, limit: 10 });
  ui.handlers.getItsmRoleReconciliation = async () => ({ checkedAt: '2026-11-10T09:00:00.000Z', findings: [] });
  ui.handlers.getItsmWorkspace = async () => workspace([{ id: 'SVC-01', name: 'Messagerie collaborative' }, { id: 'SVC-02', name: 'Portail de services' }]);
  ui.handlers.assignItsmRole = async (userId: unknown, body: any) => ({ userId, role: body.role, serviceIds: body.serviceIds });
  ui.handlers.attestItsmRole = async (userId: unknown, body: any) => ({ userId, role: body.role, serviceIds: body.serviceIds });
  ui.handlers.checkItsmRoleArchive = async () => ({ message: 'Archive des habilitations accessible.', checkedAt: '2026-11-10T09:00:00.000Z' });
}
const accountButton = (email: string) => [...document.querySelectorAll('[aria-label="Comptes du pilote"] button')]
  .find((button) => button.textContent?.includes(email)) as HTMLElement | undefined;
async function pick(email: string) {
  const button = accountButton(email);
  assert.ok(button, `compte ${email} listé`);
  await act(async () => { button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}
const roleForm = () => $('button-attest-current-role')!.closest('form')!;
async function chooseRole(value: string) {
  const select = roleForm().querySelector('select')!;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
  await act(async () => { select.dispatchEvent(new window.Event('change', { bubbles: true })); });
}
async function sendRole() {
  await act(async () => { roleForm().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
}
const text = () => document.body.textContent ?? '';

test('un compte non N1 ne voit pas l’administration des habilitations, et change le thème', async () => {
  defaultHandlers();
  await mountSettings('N2 · Interne');
  assert.equal($('panel-role-reconciliation'), null);
  assert.equal(callsTo('getItsmUserDirectory').length, 0, 'le répertoire n’est pas demandé');
  assert.equal(FakeEventSource.last, null, 'aucun flux ouvert');
  await click('button-theme-dark');
  assert.equal(ui.current.store!.theme, 'dark');
});

test('Plus Jakarta Sans est la police par défaut et les Préférences peuvent la changer', async () => {
  window.localStorage.removeItem('anif-app-font-v1');
  defaultHandlers();
  const settings = await mountSettings('N2 · Interne');
  assert.ok(settings.querySelector('[data-testid="page-intro"]'), 'Préférences utilisent le gabarit d’en-tête partagé');
  const plusJakarta = settings.querySelector('[data-testid="button-font-plus-jakarta"]') as HTMLButtonElement;
  assert.equal(plusJakarta.getAttribute('aria-pressed'), 'true');
  assert.equal(document.documentElement.dataset.appFont, 'plus-jakarta');

  await click('button-font-inter');
  assert.equal(document.documentElement.dataset.appFont, 'inter');
  assert.equal(document.documentElement.dataset.textSize, 'standard');
  await click('button-text-size-tres-grand');
  assert.equal(document.documentElement.dataset.textSize, 'tres-grand');
  assert.equal(settings.querySelector('[data-testid="button-text-size-tres-grand"]')!.getAttribute('aria-pressed'), 'true');
  assert.equal(window.localStorage.getItem('anif-text-size-v1'), 'tres-grand');
  await click('button-text-size-standard');
  assert.equal(window.localStorage.getItem('anif-app-font-v1'), 'inter');
  assert.equal(settings.querySelector('[data-testid="button-font-inter"]')?.getAttribute('aria-pressed'), 'true');

  await click('button-font-dm-sans');
  assert.equal(document.documentElement.dataset.appFont, 'dm-sans');
  assert.equal(window.localStorage.getItem('anif-app-font-v1'), 'dm-sans');

  await click('button-font-plus-jakarta');
  assert.equal(document.documentElement.dataset.appFont, 'plus-jakarta');
  assert.equal(window.localStorage.getItem('anif-app-font-v1'), 'plus-jakarta');
});

test('les Préférences activent et désactivent le filigrane pour ce navigateur', async () => {
  window.localStorage.removeItem('anif-watermark-enabled');
  defaultHandlers();
  const settings = await mountSettings('N2 · Interne');
  const watermark = await mountWatermark();

  const toggle = settings.querySelector('[data-testid="button-watermark-toggle"]') as HTMLButtonElement;
  assert.equal(toggle.getAttribute('aria-checked'), 'true', 'activé par défaut');
  assert.ok(watermark.querySelector('[data-testid="watermark"]'), 'visible à l’écran');

  await click('button-watermark-toggle');
  await settle();
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(window.localStorage.getItem('anif-watermark-enabled'), 'false');
  assert.equal(watermark.querySelector('[data-testid="watermark"]'), null, 'masqué après désactivation');

  await click('button-watermark-toggle');
  await settle();
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(window.localStorage.getItem('anif-watermark-enabled'), 'true');
  assert.ok(watermark.querySelector('[data-testid="watermark"]'), 'réaffiché après réactivation');
});

test('un N1 attribue N3 sur un service : catalogue relu, appel envoyé, répertoire rechargé', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  assert.ok($('text-reconciliation-ok'), 'aucun écart Clerk / journal');
  assert.match(FakeEventSource.last!.url, /\/api\/itsm\/users\/events$/u);
  await FakeEventSource.last!.emit('open');
  assert.match(text(), /Répertoire actualisé en direct/u);

  await pick('agent@example.test');
  await chooseRole('N3');
  await click('input-role-service-SVC-02');
  const before = callsTo('getItsmUserDirectory').length;
  await sendRole();
  assert.equal(callsTo('getItsmWorkspace').length, 1, 'le catalogue est relu avant l’envoi');
  assert.deepEqual(callsTo('assignItsmRole')[0]!.args, ['user_agent', { role: 'N3', serviceIds: ['SVC-02'] }]);
  assert.match(text(), /Rôle N3 attribué au compte user_agent\./u);
  assert.ok(callsTo('getItsmUserDirectory').length > before, 'le répertoire est rechargé');
});

test('un service disparu du catalogue entre-temps bloque l’attribution', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  await pick('agent@example.test');
  await chooseRole('N3');
  await click('input-role-service-SVC-02');
  ui.handlers.getItsmWorkspace = async () => workspace([{ id: 'SVC-01', name: 'Messagerie collaborative' }]);
  await sendRole();
  assert.equal(callsTo('assignItsmRole').length, 0, 'rien n’est envoyé');
  assert.match($('status-role-assignment-error')!.textContent!, /Le service Portail de services n’est plus présent/u);
  assert.equal($('input-role-service-SVC-02'), null, 'la liste est actualisée');
});

test('l’attribution exige une vérification Clerk récente : réussie, l’appel est relancé ; annulée, rien ne change', async () => {
  defaultHandlers();
  let attempts = 0;
  ui.handlers.assignItsmRole = async (userId: unknown, body: any) => {
    attempts += 1;
    if (attempts === 1) throw hint;
    return { userId, role: body.role, serviceIds: body.serviceIds };
  };
  await mountSettings('N1 · Direction');
  await pick('agent@example.test');
  await chooseRole('N5');
  await sendRole();
  assert.equal(ui.clerk.dialogs, 1, 'la fenêtre de vérification s’ouvre');
  assert.equal(attempts, 2, 'l’appel est relancé après vérification');
  assert.match(text(), /Rôle N5 attribué au compte user_agent\./u);

  ui.clerk.reverify = 'cancel';
  ui.handlers.assignItsmRole = async () => { throw hint; };
  await pick('agent@example.test');
  await chooseRole('N5');
  await sendRole();
  assert.equal($('status-role-assignment-error')!.textContent, 'Vérification d’identité annulée : l’action n’a pas été effectuée.');
});

test('le second facteur exigé par l’API est expliqué, et un refus 403 garde le motif du serveur', async () => {
  defaultHandlers();
  ui.handlers.assignItsmRole = async () => { throw { status: 403, data: { code: 'second_factor_required', error: 'Activez la double authentification sur votre compte.' } }; };
  await mountSettings('N1 · Direction');
  await pick('agent@example.test');
  await sendRole();
  assert.equal($('status-role-assignment-error')!.textContent, 'Activez la double authentification sur votre compte.');
  ui.handlers.assignItsmRole = async () => { throw Object.assign(new Error('Forbidden'), { status: 403, data: { error: 'Le dernier N1 actif ne peut pas être révoqué.' } }); };
  await sendRole();
  assert.equal($('status-role-assignment-error')!.textContent, 'Le dernier N1 actif ne peut pas être révoqué. Le rôle n’a pas été modifié.');
});

test('la révocation demande confirmation ; refusée, aucun appel ; acceptée, l’accès est retiré', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  await pick('agent@example.test');
  await chooseRole('REVOKE');
  confirmAnswers.push(false);
  await sendRole();
  assert.equal(callsTo('assignItsmRole').length, 0);
  assert.match(confirmations[0]!, /Retirer entièrement l’accès ITSM de ce compte/u);
  confirmAnswers.push(true);
  await sendRole();
  assert.deepEqual(callsTo('assignItsmRole')[0]!.args, ['user_agent', { role: null, serviceIds: [] }]);
  assert.match(text(), /Accès ITSM retiré pour le compte user_agent\./u);
});

test('un périmètre hors catalogue est signalé et sa correction confirmée explicitement', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  assert.ok($('status-directory-unavailable-services-user_appui'));
  await pick('appui@example.test');
  assert.match($('status-unavailable-account-services')!.textContent!, /SVC-99/u);
  assert.equal(($('input-role-service-SVC-01') as HTMLInputElement).checked, true, 'seuls les services connus sont cochés');
  confirmAnswers.push(true);
  await sendRole();
  assert.match(confirmations[0]!, /Les identifiants absents du pilote \(SVC-99\) seront retirés\. Le rôle N4 restera inchangé\./u);
  assert.deepEqual(callsTo('assignItsmRole')[0]!.args, ['user_appui', { role: 'N4', serviceIds: ['SVC-01'] }]);
});

test('attester le rôle actuel d’un compte signalé par le contrôle, avec confirmation', async () => {
  defaultHandlers();
  ui.handlers.getItsmRoleReconciliation = async () => ({ checkedAt: '2026-11-10T09:00:00.000Z', findings: [{ userId: 'user_agent', reason: 'missing_audit', clerkRole: 'N2', clerkServiceIds: [], auditRole: null, auditServiceIds: [] }] });
  await mountSettings('N1 · Direction');
  assert.ok($('row-reconciliation-user_agent'));
  await click('button-review-user_agent');
  await settle(); // la recherche du compte relance le répertoire
  assert.match($('text-attestation-scope')!.textContent!, /tous les services/u);
  const reconciliationsBefore = callsTo('getItsmRoleReconciliation').length;
  await click('button-attest-current-role');
  await settle();
  assert.match(confirmations[0]!, /Confirmez-vous avoir vérifié le rôle N2/u);
  assert.deepEqual(callsTo('attestItsmRole')[0]!.args, ['user_agent', { role: 'N2', serviceIds: [] }]);
  assert.equal($('status-role-attestation-success')!.textContent, 'Attestation actuelle du rôle N2 enregistrée pour le compte user_agent.');
  assert.ok(callsTo('getItsmRoleReconciliation').length > reconciliationsBefore, 'le contrôle est relancé');
});

test('une attestation dont la vérification Clerk est annulée n’est pas enregistrée', async () => {
  defaultHandlers();
  ui.handlers.attestItsmRole = async () => { throw hint; };
  await mountSettings('N1 · Direction');
  ui.clerk.reverify = 'cancel';
  await pick('agent@example.test');
  await click('button-attest-current-role');
  await settle();
  assert.equal($('status-role-attestation-error')!.textContent, 'Vérification d’identité annulée : l’action n’a pas été effectuée.');
  assert.equal($('status-role-attestation-success'), null);
});

test('un N1 dont l’accès est retiré perd le répertoire : par le flux, puis par un refus 403', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  await pick('agent@example.test');
  assert.equal(cachedDirectories().length, 1, 'le répertoire est en cache avant le retrait');
  await FakeEventSource.last!.emit('access-revoked');
  assert.ok(FakeEventSource.last!.closed, 'le flux est fermé');
  assert.match(text(), /Votre accès N1 a changé\. Le répertoire a été effacé de cette session/u);
  assert.equal(accountButton('agent@example.test'), undefined, 'les comptes ne sont plus affichés');
  await settle();
  assert.equal(cachedDirectories().length, 0, 'le répertoire est effacé du cache');
});

test('un refus 403 du répertoire efface aussi l’administration', async () => {
  defaultHandlers();
  // Comme une vraie requête : la réponse arrive après un tour de boucle d'événements.
  ui.handlers.getItsmUserDirectory = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  await mountSettings('N1 · Direction');
  assert.match(text(), /Votre accès N1 a changé/u);
  assert.equal($('button-attest-current-role'), null);
  assert.equal(cachedDirectories().length, 0, 'aucun répertoire en cache');
  const afterDenial = callsTo('getItsmUserDirectory').length;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  assert.equal(callsTo('getItsmUserDirectory').length, afterDenial, 'plus aucun appel au répertoire après le refus');
  assert.ok(afterDenial <= 2, `au plus un nouvel essai (${afterDenial})`);
});

test('le contrôle de l’archive des habilitations affiche le résultat et l’heure du dernier essai', async () => {
  defaultHandlers();
  await mountSettings('N1 · Direction');
  const archiveButton = () => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Tester la connexion')) as HTMLElement;
  await act(async () => { archiveButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await settle();
  assert.match(text(), /Archive des habilitations accessible\./u);
  assert.match(text(), /résultat : archive accessible\./u);
  ui.handlers.checkItsmRoleArchive = async () => { throw Object.assign(new Error('Archive indisponible'), { status: 503, data: { checkedAt: '2026-11-10T09:05:00.000Z' } }); };
  await act(async () => { archiveButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await settle();
  assert.match(text(), /résultat : archive indisponible\./u);
});

test('trois incidents sur un même service ouvrent un problème lié, puis l’alerte disparaît', async () => {
  await mountTickets();
  assert.equal($('recurrence-alerts'), null, 'aucune alerte sans incident');
  for (const n of [1, 2, 3]) {
    await createTicket({ 'select-kind': 'Incident', 'input-title': `Portail lent ${n}`, 'select-service': 'SVC-02', 'select-category': 'Applications' });
  }
  assert.match($('recurrence-alerts')?.textContent ?? '', /Portail de services · Applications · 3 incidents \(INC-2401, INC-2402, INC-2403\)/u);

  await click('button-open-problem-0');
  assert.equal(($('select-kind') as HTMLSelectElement).value, 'Problème');
  assert.equal(($('select-service') as HTMLSelectElement).value, 'SVC-02');
  await submitForm('button-submit-ticket');
  const problem = tickets()[0]!;
  assert.deepEqual([problem.id, problem.kind, problem.incidentIds], ['PRB-2404', 'Problème', ['INC-2401', 'INC-2402', 'INC-2403']]);
  assert.equal(ui.logs.at(-1)!.action, 'Ticket PRB-2404 créé (Problème, P3) depuis 3 incidents récurrents');
  assert.equal($('recurrence-alerts'), null, 'incidents rattachés : plus d’alerte');
  assert.match($('text-linked-incidents')?.textContent ?? '', /INC-2401, INC-2402, INC-2403/u);

  await click('row-ticket-INC-2402');
  assert.match($('text-linked-problem')?.textContent ?? '', /Rattaché au problème PRB-2404/u);

  // A plain creation afterwards carries no link.
  await createTicket({ 'select-kind': 'Problème', 'input-title': 'Autre problème' });
  assert.ok(!('incidentIds' in tickets()[0]!));
});

test('une demande préformatée préremplit le formulaire ; seule la demande standard est prise en compte d’office', async () => {
  await mountTickets();
  await click('button-create-ticket');
  await click('button-template-compte');
  assert.equal(($('input-title') as HTMLInputElement).value, 'Création de compte utilisateur');
  assert.equal(($('select-kind') as HTMLSelectElement).value, 'Demande');
  assert.match($('text-template-approval')?.textContent ?? '', /validée par le support/u);
  await click('button-template-mot-de-passe');
  assert.equal(($('select-category') as HTMLSelectElement).value, 'Accès');
  assert.match($('text-template-approval')?.textContent ?? '', /automatiquement/u);
  await submitForm('button-submit-ticket');
  let [created] = tickets();
  assert.deepEqual([created!.status, created!.template, Boolean(created!.acknowledgedAt)], ['Pris en compte', 'mot-de-passe', true]);

  // Changing the category drops the auto-approval.
  await click('button-create-ticket');
  assert.equal($('text-template-approval'), null, 'aucun modèle repris d’une création précédente');
  await click('button-template-mot-de-passe');
  await fill('select-category', 'Réseau');
  await submitForm('button-submit-ticket');
  [created] = tickets();
  assert.deepEqual([created!.status, 'template' in created!], ['Nouveau', false]);
});

test('la saisie du sujet propose les erreurs connues proches, sans quitter le formulaire', async () => {
  const store = ui.testStore();
  store.kedb = [{ id: 'KB-0001', title: 'Certificat SMTP expiré', symptom: 'Messagerie inaccessible', rootCause: 'Certificat du relais expiré', resolution: 'Renouvellement du certificat', ticketId: 'INC-2400', category: 'Applications', createdAt: new Date().toISOString(), author: 'user_n3' }];
  await mountTickets('', store);
  await click('button-create-ticket');
  assert.equal($('kedb-suggestions'), null, 'rien avant la saisie');
  await fill('input-title', 'Imprimante bloquée');
  assert.equal($('kedb-suggestions'), null, 'aucune fiche proche');
  await fill('input-title', 'Messagerie bloquée, certificat refusé');
  assert.match($('kedb-suggestion-KB-0001')?.textContent ?? '', /Renouvellement du certificat/u);
  await submitForm('button-submit-ticket');
  assert.equal(tickets()[0]!.title, 'Messagerie bloquée, certificat refusé', 'la suggestion n’empêche pas la création');
});
