/**
 * Tests des écrans de consultation : tableau de bord, parc matériel, catalogue
 * et KEDB, gouvernance, journal d'activité. Vraies pages React dans jsdom, avec
 * le store, l'API et le routeur remplacés par des doublures (tests/components).
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
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const tickets = () => [
  // P1 ouvert il y a 3 h sans prise en charge : délais de prise en charge (15 min) et de résolution (2 h) dépassés.
  ui.normalizeTicket({ id: 'INC-2410', title: 'Panne du portail', impact: 1, urgency: 1, status: 'Nouveau', serviceId: 'SVC-02', openedAt: minutesAgo(180), acknowledgedAt: null }),
  ui.normalizeTicket({ id: 'REQ-2411', title: 'Nouveau poste', kind: 'Demande', impact: 3, urgency: 3, status: 'Pris en compte', assetId: 'MAT-0874', openedAt: minutesAgo(10), acknowledgedAt: minutesAgo(5) }),
  ui.normalizeTicket({ id: 'INC-2400', title: 'Ancien incident', impact: 2, urgency: 2, status: 'Clos', assetId: 'MAT-0874', openedAt: minutesAgo(5000), closedAt: minutesAgo(4000) }),
];
const kedb = [
  { id: 'KB-0001', title: 'Certificat SMTP expiré', symptom: 'Messagerie inaccessible', rootCause: 'Certificat du relais expiré', resolution: 'Renouvellement du certificat', ticketId: 'INC-2400', category: 'Applications', createdAt: minutesAgo(4000), author: 'user_n3' },
  { id: 'KB-0002', title: 'Point d’accès saturé', symptom: 'Wi-Fi lent aile Est', rootCause: 'Canal radio encombré', resolution: 'Changement de canal', ticketId: 'INC-2399', category: 'Réseau', createdAt: minutesAgo(9000), author: 'user_n3' },
];
const conversations = [
  { id: 'C-1', title: 'Équipe', kind: 'Groupe', classification: 'Interne', participants: [], readCount: 0, messages: [{ id: 'x1', author: 'a', body: 'Bonjour', time: '', at: minutesAgo(3) }, { id: 'x2', author: 'a', body: 'Point à 10 h', time: '', at: minutesAgo(2) }] },
];
const auditEvents = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `ev-${i}`, action: i % 2 ? `Ticket INC-${i} consulté` : `Message envoyé ${i}`, actor: 'user_n3',
  scope: i % 2 ? 'Support informatique' : 'Messagerie', time: '', at: minutesAgo(i * 60),
}));

async function mount(page: unknown, { clearance = 'N2 · Interne', search = '', withData = true, audit = auditEvents(3), services = undefined as unknown[] | undefined } = {}) {
  ui.calls.length = 0;
  ui.logs.length = 0;
  ui.router.path = '/';
  ui.router.search = search;
  ui.router.history.length = 0;
  ui.clock.now = Date.now();
  const store = ui.testStore(withData ? tickets() : [], withData ? conversations : []);
  store.profile = { ...store.profile, name: 'user_me', clearance };
  store.kedb = withData ? kedb : [];
  store.audit = audit;
  if (services) store.services = services as never;
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ui.QueryClientProvider, { client }, createElement(ui.TestStoreProvider, { initial: store }, createElement(page as never))));
  });
  await settle();
  roots.push(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
}
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const text = () => document.body.textContent ?? '';
async function click(target: string | HTMLElement) {
  const element = typeof target === 'string' ? $(target) : target;
  assert.ok(element, `${target} présent`);
  await act(async () => { element!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await settle();
}
async function fill(target: string | HTMLElement, value: string) {
  const element = (typeof target === 'string' ? $(target) : target) as HTMLElement;
  assert.ok(element, `${target} présent`);
  const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  await act(async () => { element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const byText = (selector: string, needle: string) => [...document.querySelectorAll(selector)].find((element) => element.textContent?.includes(needle)) as HTMLElement | undefined;

// --- Tableau de bord ---------------------------------------------------------

test('le tableau de bord classe la file de travail, filtre par priorité et état, et signale le SLA dépassé', async () => {
  await mount(ui.DashboardPage);
  const queue = () => [...document.querySelectorAll('[data-testid^="link-dashboard-ticket-"]')].map((link) => (link as HTMLElement).dataset.testid!.replace('link-dashboard-ticket-', ''));
  assert.match(text(), /File de travail\s*02 ouverts/u, 'le ticket clos est ignoré');
  assert.deepEqual(queue(), ['INC-2410'], 'seul le premier ticket est montré par défaut');
  assert.match($('link-dashboard-ticket-INC-2410')!.textContent!, /prise en charge dépassée|de \d+ h/u, 'P1 sans prise en charge depuis 3 h');
  assert.match(text(), /FOCUS DU MOMENT\s*Panne du portail/u);
  await click(byText('button', 'Afficher la file complète')!);
  assert.deepEqual(queue(), ['INC-2410', 'REQ-2411'], 'P1 avant P4');

  const chip = (label: string) => [...document.querySelectorAll('[aria-label="Filtrer la file de travail"] button')].find((button) => button.textContent!.startsWith(label)) as HTMLElement;
  await click(chip('À prendre'));
  assert.deepEqual(queue(), ['INC-2410'], 'nouveaux tickets');
  await click(chip('P2'));
  assert.deepEqual(queue(), []);
  assert.match(text(), /Aucun ticket dans ce filtre/u);
  await click(chip('Tous'));
  await click(byText('button', 'Vue de garde')!);
  assert.equal(byText('button', 'Quitter la vue de garde')!.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(queue(), ['INC-2410'], 'la garde ne garde que P1 et P2');

  assert.match(text(), /3\/4 opérationnel\(s\) · 1 vigilance/u);
  assert.match(text(), /1 conversation\(s\) · 2 message\(s\) non lu\(s\)/u);
  assert.match(text(), /Activité récente/u);
  assert.ok(byText('li', 'Message envoyé 0'), 'événement le plus récent du journal');
  await click('link-dashboard-ticket-INC-2410');
  assert.equal(ui.logs.at(-1)!.action, 'Ticket INC-2410 ouvert depuis la vue générale');
});

test('un auditeur N5 voit une vue limitée, sans tickets ni conversations', async () => {
  await mount(ui.DashboardPage, { clearance: 'N5 · Audit' });
  assert.equal(byText('h3', 'File de travail'), undefined);
  assert.equal($('link-new-request'), null);
  assert.match(text(), /Consultation limitée/u);
  assert.match(text(), /Articles KEDB consultables/u);
});

// --- Parc matériel -----------------------------------------------------------

test('le parc se filtre par état et par recherche ; la fiche liste les tickets et ouvre une demande préremplie', async () => {
  await mount(ui.AssetsPage);
  const rows = () => [...document.querySelectorAll('[data-testid^="button-asset-details-"]')].map((row) => (row as HTMLElement).dataset.testid!.replace('button-asset-details-', ''));
  assert.equal(rows().length, 5);
  await fill(document.querySelector('select[aria-label="Filtrer par état"]') as HTMLElement, 'En stock');
  assert.deepEqual(rows(), ['MAT-0913']);
  await fill(document.querySelector('select[aria-label="Filtrer par état"]') as HTMLElement, 'Tous');
  await fill('input-search-assets', 'accueil');
  assert.deepEqual(rows(), ['MAT-0641', 'MAT-0874'], 'nom (station d’accueil) et emplacement (Accueil)');
  await fill('input-search-assets', 'mat-0874');
  assert.deepEqual(rows(), ['MAT-0874'], 'recherche insensible à la casse sur l’identifiant');
  await click('button-asset-details-MAT-0874');
  assert.match(text(), /Fiche équipement/u);
  assert.ok(byText('a', 'REQ-2411') && byText('a', 'INC-2400'), 'tickets ouverts et clos de l’équipement');
  const request = [...document.querySelectorAll('a')].find((link) => link.getAttribute('href') === '/tickets?new=1&asset=MAT-0874');
  assert.ok(request, 'demande préremplie pour cet équipement');
  await fill('input-search-assets', 'introuvable');
  assert.equal(rows().length, 0);
});

// --- Catalogue et KEDB -------------------------------------------------------

test('le catalogue filtre les services ; la KEDB se cherche et chaque consultation est journalisée', async () => {
  await mount(ui.ServicesPage);
  await fill('input-search-services', 'portail');
  assert.ok($('button-service-details-SVC-02'));
  assert.equal($('button-service-details-SVC-01'), null);
  await click('button-service-details-SVC-02');
  assert.match(text(), /Support applicatif/u, 'fiche du service');
  assert.ok($('link-request-SVC-02'), 'demande depuis le service');

  await fill('input-search-kedb', 'wi-fi');
  assert.ok($('row-kedb-KB-0002'));
  assert.equal($('row-kedb-KB-0001'), null);
  await click('row-kedb-KB-0002');
  assert.equal(ui.logs.at(-1)!.action, 'Article KB-0002 consulté');
  assert.match(text(), /Changement de canal/u);
  await fill('input-search-kedb', 'aucun-resultat');
  assert.match(text(), /Aucun article ne correspond/u);
});

test('un lien vers un article KEDB l’ouvre puis nettoie l’adresse ; un auditeur ne voit pas le catalogue', async () => {
  await mount(ui.ServicesPage, { search: 'kedb=KB-0001' });
  assert.match(text(), /Renouvellement du certificat/u);
  assert.deepEqual(ui.router.history, ['/services']);
  assert.ok($('link-kedb-source'), 'lien vers le ticket d’origine');
  await mount(ui.ServicesPage, { clearance: 'N5 · Audit' });
  assert.ok(document.querySelector('section.hidden [data-testid="input-search-services"]'), 'catalogue masqué pour N5');
});

test('l’assistant de diagnostic vérifie le pilote, propose la KEDB et prépare un ticket guidé repris par la file', async () => {
  window.sessionStorage.clear();
  await mount(ui.ServicesPage);
  assert.ok($('section-diagnostic-assistant'));
  await fill('select-diagnostic-service', 'SVC-03');
  await click('button-diagnostic-symptom-performance');
  await fill('select-diagnostic-impact', '1');
  await click('button-run-diagnostic');
  assert.equal(ui.logs.at(-1)!.action, 'Contrôle d’autodiagnostic lancé');
  assert.ok($('diagnostic-results'));
  assert.match($('status-diagnostic-catalog')!.textContent!, /Opérationnel/u, 'état du réseau des bureaux dans le catalogue');
  assert.match($('status-diagnostic-nkok')!.textContent!, /Non configurées · aucun test effectué/u, 'aucune sonde inventée');
  assert.ok($('diagnostic-kedb-suggestions'));
  await click('button-diagnostic-create-ticket');
  assert.equal(ui.logs.at(-1)!.action, 'Préparation d’un ticket guidé pour SVC-03');
  assert.deepEqual(ui.router.history, ['/tickets?new=1&diagnostic=1&service=SVC-03']);
  const handoff = JSON.parse(window.sessionStorage.getItem('anif-diagnostic-ticket-handoff-v1') ?? 'null');
  assert.equal(handoff?.serviceId, 'SVC-03');
  assert.equal(handoff?.symptomId, 'performance');
  assert.equal(handoff?.impact, 1);

  // La file des tickets reprend le résumé, une seule fois.
  await mount(ui.TicketsPage, { search: 'new=1&diagnostic=1&service=SVC-03' });
  assert.match(text(), /Résumé du diagnostic repris/u);
  assert.equal(($('select-service') as HTMLSelectElement).value, 'SVC-03');
  assert.equal(window.sessionStorage.getItem('anif-diagnostic-ticket-handoff-v1'), null, 'le résumé est consommé');
});

test('l’assistant de diagnostic distingue une API accessible, en échec ou un poste hors ligne', async () => {
  window.sessionStorage.clear();
  ui.health.next = { status: 'ok' };
  await mount(ui.ServicesPage);
  await click('button-run-diagnostic');
  assert.match($('status-diagnostic-api')!.textContent!, /Accessible/u);
  assert.match($('status-diagnostic-network')!.textContent!, /En ligne/u);
  await click('button-diagnostic-create-ticket');
  assert.equal(JSON.parse(window.sessionStorage.getItem('anif-diagnostic-ticket-handoff-v1')!).apiProbe, 'healthy');

  window.sessionStorage.clear();
  ui.health.next = 'error';
  await mount(ui.ServicesPage);
  await fill('select-diagnostic-service', 'SVC-02');
  await click('button-run-diagnostic');
  assert.match($('status-diagnostic-api')!.textContent!, /Indisponible/u);
  assert.ok($('text-diagnostic-api-error'), 'un ticket reste possible');
  assert.match($('status-diagnostic-catalog')!.textContent!, /Vigilance/u);
  await click('button-diagnostic-create-ticket');
  assert.equal(JSON.parse(window.sessionStorage.getItem('anif-diagnostic-ticket-handoff-v1')!).apiProbe, 'unavailable');

  // Changer de service efface les résultats : ils ne valent que pour le service vérifié.
  await fill('select-diagnostic-service', 'SVC-01');
  assert.equal($('diagnostic-results'), null);

  const online = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  try {
    await click('button-run-diagnostic');
    assert.match($('status-diagnostic-network')!.textContent!, /Hors ligne/u);
  } finally {
    if (online) Object.defineProperty(window.navigator, 'onLine', online); else delete (window.navigator as unknown as Record<string, unknown>).onLine;
  }
  ui.health.next = { status: 'ok' };
});

test('un résumé de diagnostic qui ne peut pas être conservé ne crée rien', async () => {
  await mount(ui.ServicesPage);
  await click('button-run-diagnostic');
  const setItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = () => { throw new Error('quota'); };
  try {
    await click('button-diagnostic-create-ticket');
  } finally {
    window.Storage.prototype.setItem = setItem;
  }
  assert.match($('text-diagnostic-handoff-error')!.textContent!, /Aucun ticket n’a été créé/u);
  assert.deepEqual(ui.router.history, [], 'pas de navigation');
});

test('sans service au catalogue, l’assistant ne lance rien', async () => {
  await mount(ui.ServicesPage, { withData: false, services: [] });
  assert.equal(($('button-run-diagnostic') as HTMLButtonElement).disabled, true);
  assert.match($('select-diagnostic-service')!.textContent!, /Aucun service autorisé/u);
});

test('une KEDB vide invite à documenter une résolution', async () => {
  await mount(ui.ServicesPage, { withData: false });
  assert.match(text(), /Aucune résolution validée pour l’instant/u);
});

// --- Gouvernance --------------------------------------------------------------

test('la gouvernance change de vue par rôle et décrit honnêtement ce qui est livré pour le journal', async () => {
  await mount(ui.GovernancePage);
  await click('button-role-view-N5');
  assert.equal(ui.logs.at(-1)!.action, 'Vue de gouvernance N5 consultée');
  const journal = $('status-control-Journalisation')!.closest('div.grid')!.textContent!;
  assert.match(journal, /horodatage RFC 3161/u);
  assert.match(journal, /archive des sceaux en ajout seul/u);
  assert.match(journal, /Reste : stockage WORM matériel/u);
  assert.doesNotMatch(text(), /aucune garantie WORM/u, 'plus de mention périmée');
  assert.match($('status-control-Identité forte')!.closest('div.grid')!.textContent!, /vérification d’identité Clerk de moins de 10 minutes/u);
});

// --- Journal d'activité ---------------------------------------------------------

test('le journal pagine par 50, filtre par périmètre, texte et dates, et signale des dates incohérentes', async () => {
  await mount(ui.AuditPage, { audit: auditEvents(120) });
  assert.match($('text-audit-page-range')!.textContent!, /Affichage de 1 à 50 sur 120 événements/u);
  assert.equal($('text-audit-current-page')!.textContent, 'Page 1 / 3');
  assert.equal(($('button-audit-previous-page') as HTMLButtonElement).disabled, true);
  await click('button-audit-next-page');
  await click('button-audit-next-page');
  assert.match($('text-audit-page-range')!.textContent!, /Affichage de 101 à 120 sur 120/u);
  assert.equal(($('button-audit-next-page') as HTMLButtonElement).disabled, true);

  await fill('filter-scope', 'Messagerie');
  assert.match($('text-audit-page-range')!.textContent!, /sur 60 événements/u, 'retour à la première page, 60 événements');
  await fill('input-search-audit', 'Message envoyé 4');
  assert.match($('text-audit-page-range')!.textContent!, /sur 6 événements/u, 'événements 4, 40, 42, 44, 46 et 48');
  await click('button-clear-audit-filters');
  assert.match($('text-audit-page-range')!.textContent!, /sur 120 événements/u);

  await fill('input-date-from', '2026-12-31');
  await fill('input-date-to', '2026-01-01');
  assert.ok(byText('[role="alert"]', ''), 'erreur de dates affichée');
  assert.ok($('empty-audit-state'));
  await click('button-clear-audit-filters');
  await click('button-audit-today');
  assert.ok(($('input-date-from') as HTMLInputElement).value, 'période rapide appliquée');
});

test('l’export CSV télécharge la sélection filtrée, et un refus du serveur est affiché', async () => {
  const requests: string[] = [];
  let answer: () => Promise<unknown> = async () => ({ ok: true, blob: async () => new Blob(['seq;action\n']), json: async () => ({}) });
  (globalThis as Record<string, unknown>).fetch = async (url: string) => { requests.push(url); return answer(); };
  const created: string[] = [];
  (URL as unknown as Record<string, unknown>).createObjectURL = () => { created.push('blob:1'); return 'blob:1'; };
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
  const downloads: string[] = [];
  window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) { downloads.push(this.download); };

  await mount(ui.AuditPage, { clearance: 'N3 · Support' });
  assert.ok($('panel-audit-integrity'), 'un N3 voit les panneaux de preuve');
  await fill('filter-scope', 'Messagerie');
  await click('button-export-csv');
  await settle();
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /^\/api\/itsm\/audit\/export\?q=&scope=Messagerie&from=&to=$/u);
  assert.equal(created.length, 1);
  assert.match(downloads[0]!, /^journal-anif-.*\.csv$/u);

  answer = async () => ({ ok: false, json: async () => ({ error: 'Export réservé aux comptes N1, N3 et N5.' }), blob: async () => new Blob() });
  await click('button-export-csv');
  await settle();
  assert.match(text(), /Export réservé aux comptes N1, N3 et N5\./u);
});

test('un N2 ne voit ni l’export ni les panneaux de preuve du journal', async () => {
  await mount(ui.AuditPage);
  assert.equal($('panel-audit-integrity'), null);
  assert.equal($('panel-audit-siem'), null);
});

test('un journal vide affiche l’état vide sans pagination', async () => {
  await mount(ui.AuditPage, { audit: [] });
  assert.ok($('empty-audit-state'));
  assert.equal($('text-audit-page-range'), null);
});
