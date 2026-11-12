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
    await act(async () => { $('button-notifications')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    const personal = $('link-notification-mention:d1');
    assert.ok(personal, 'la mention de mon nom affiché est notifiée');
    assert.equal(personal!.getAttribute('href'), '/messages?c=C-DIR&m=d1');
    assert.match(personal!.textContent!, /Vous êtes mentionné/u);
    assert.match(personal!.parentElement!.textContent!, /: Tu peux valider/u, 'l’auteur précède l’extrait');
    assert.equal($('link-notification-mention:q1')!.getAttribute('href'), '/messages?c=C-EQ&m=q1');
    assert.equal($('link-notification-mention:d2'), null, 'mon propre @tous ne me notifie pas');
    await act(async () => { personal!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.ok((ui.current.store!.notifRead as string[]).includes('mention:d1'), 'ouvrir la notification la marque lue');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
