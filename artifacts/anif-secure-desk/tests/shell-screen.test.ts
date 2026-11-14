/** Cloche de notifications du bandeau : vraie coquille React dans jsdom, avec les doublures de tests/components. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, loadComponents } from './components/harness.ts';

const dom = installDom();
test.after(() => dom.window.close());
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await loadComponents();

const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

test('le menu latéral s’ouvre depuis le bandeau et se ferme avec Échap en restaurant le focus', async () => {
  ui.router.path = '/';
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ui.QueryClientProvider, { client }, createElement(ui.TestStoreProvider, { initial: ui.testStore([], []) }, createElement(ui.Shell, null, 'contenu'))));
  });
  try {
    const trigger = $('button-mobile-nav') as HTMLButtonElement;
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await act(async () => { trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    const drawer = $('workspace-drawer')!;
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(drawer.getAttribute('aria-hidden'), 'false');
    assert.equal(drawer.getAttribute('aria-modal'), 'true');
    assert.ok($('workspace-backdrop'), 'un voile ferme le reste de la page');
    assert.equal(document.activeElement, $('button-close-workspace'), 'le focus entre dans le volet');
    assert.equal(document.body.style.overflow, 'hidden');

    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(drawer.getAttribute('aria-hidden'), 'true');
    assert.equal($('workspace-backdrop'), null);
    assert.equal(document.activeElement, trigger, 'le focus revient au bouton du menu');
    assert.equal(document.body.style.overflow, '');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

test('une mention de mon nom ou de @tous arrive dans la cloche et mène au message ; mes propres mentions non', async () => {
  ui.router.path = '/messages';
  ui.clock.now = Date.now();
  const me = 'user_n1'; // identifiant Clerk de la doublure, nom affiché « Awa N1 »
  const store = ui.testStore([], [
    { id: 'C-DIR', title: 'Échange bilatéral', kind: 'Direct', classification: 'Confidentiel', participants: [me, 'user_agent'], memberIds: [me, 'user_agent'], readCount: 0, messages: [
      { id: 'd1', author: 'user_agent', body: 'Tu peux valider, @Awa N1 ?', time: '', at: at(5) },
      { id: 'd2', author: me, body: 'Oui, @tous je regarde.', time: '', at: at(4) },
    ] },
    { id: 'C-EQ', title: 'Équipe réseau', kind: 'Équipe', classification: 'Interne', participants: [me, 'Équipe'], readCount: 0, messages: [
      { id: 'q1', author: 'user_agent', body: 'Coupure à 18 h, @TOUS.', time: '', at: at(3) },
    ] },
  ] as never);
  store.profile = { ...store.profile, name: me };
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(ui.QueryClientProvider, { client }, createElement(ui.TestStoreProvider, { initial: store }, createElement(ui.Shell, null, 'contenu')))); });
  try {
    ui.handlers.setItsmNotificationReads = async (input) => ({ marked: (input as { ids: string[] }).ids.length });
    await act(async () => { $('button-notifications')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    const personal = $('link-notification-mention:d1');
    assert.ok(personal, 'la mention de mon nom affiché est notifiée');
    assert.equal(personal!.getAttribute('href'), '/messages?c=C-DIR&m=d1');
    assert.match(personal!.textContent!, /Vous êtes mentionné/u);
    assert.match(personal!.parentElement!.textContent!, /: Tu peux valider/u, 'l’auteur précède l’extrait');
    assert.equal($('link-notification-mention:q1')!.getAttribute('href'), '/messages?c=C-EQ&m=q1');
    assert.equal($('link-notification-mention:d2'), null, 'mon propre @tous ne me notifie pas');
    assert.equal($('badge-notifications')!.textContent, '2');
    assert.equal($('notifications-quiet'), null);
    // Quiet hours around the current Libreville time: mentions are no longer counted, but stay listed.
    const wat = (offsetMinutes: number) => new Date(Date.now() + (60 + offsetMinutes) * 60_000).toISOString().slice(11, 16);
    await act(async () => { ui.setQuietHours({ enabled: true, start: wat(-60), end: wat(60) }); });
    assert.equal($('badge-notifications'), null, 'pendant les heures silencieuses, une mention ne fait plus de badge');
    assert.match($('notifications-quiet')!.textContent!, new RegExp(`jusqu’à ${wat(60)}`, 'u'));
    assert.ok($('link-notification-mention:q1'), 'la notification reste consultable');
    await act(async () => { ui.setQuietHours({ enabled: false, start: '18:00', end: '07:30' }); });
    assert.equal($('badge-notifications')!.textContent, '2');
    await act(async () => { personal!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.ok((ui.current.store!.notifRead as string[]).includes('mention:d1'), 'ouvrir la notification la marque lue');
    ui.handlers.setItsmNotificationReads = async () => { throw new Error('503'); };
    await act(async () => { $('button-notifications')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => { $('link-notification-mention:q1')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => { $('button-notifications')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.ok($('notifications-read-error'), 'un échec serveur est visible');
    assert.equal((ui.current.store!.notifRead as string[]).includes('mention:q1'), false, 'un refus n’est pas marqué lu localement');
    assert.equal($('badge-notifications')!.textContent, '1', 'la pastille reste tant que la lecture n’est pas enregistrée');
  } finally {
    delete ui.handlers.setItsmNotificationReads;
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

test('mon statut de présence : affiché tout de suite, enregistré par l’API, rétabli depuis le serveur en cas de refus', async () => {
  ui.router.path = '/messages';
  ui.clock.now = Date.now();
  ui.calls.length = 0;
  ui.logs.length = 0;
  const resyncsBefore = ui.resyncs.count;
  const store = ui.testStore([], []);
  store.profile = { ...store.profile, name: 'user_n1' };
  const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(ui.QueryClientProvider, { client }, createElement(ui.TestStoreProvider, { initial: store }, createElement(ui.Shell, null, 'contenu')))); });
  const choose = async (value: string) => {
    const select = $('select-presence') as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    await act(async () => { select.dispatchEvent(new window.Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
  };
  try {
    assert.equal(($('select-presence') as HTMLSelectElement).value, '', 'aucun statut choisi au départ');
    ui.handlers.setItsmPresence = async () => ({ status: 'occupe', at: new Date().toISOString() });
    await choose('occupe');
    assert.deepEqual(ui.calls.find(c => c.name === 'setItsmPresence')?.args, [{ status: 'occupe' }]);
    assert.equal(ui.current.store!.presence!.user_n1!.status, 'occupe');
    assert.equal(ui.logs.at(-1)?.action, 'Statut de présence : Ne pas déranger');
    assert.equal([...($('select-presence') as HTMLSelectElement).options].some(o => o.value === ''), false, 'le choix vide disparaît une fois un statut choisi');

    ui.handlers.setItsmPresence = async () => { throw new Error('503'); };
    await choose('absent');
    assert.equal(ui.logs.at(-1)?.action, 'Statut de présence non enregistré');
    assert.equal(ui.resyncs.count, resyncsBefore + 1, 'l’espace est rechargé pour retrouver le statut enregistré');
  } finally {
    delete ui.handlers.setItsmPresence;
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
