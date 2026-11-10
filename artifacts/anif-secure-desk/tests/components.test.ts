/**
 * Component tests of the journal panels (integrity and Merkle proof, RFC 3161
 * timestamps, SIEM download): real components in jsdom, API client stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installDom, loadComponents } from './components/harness.ts';
import { merkleInclusionProof, merkleRoot } from '../../api-server/src/lib/itsm-audit-merkle.ts';

// react-dom decides at load time whether a DOM exists: load it only after jsdom is installed.
installDom();
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await loadComponents();

async function mount(element: unknown) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(element as never); });
  return { container, unmount: () => act(async () => root.unmount()) };
}
const byTestId = (container: Element, id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function click(element: HTMLElement | null) {
  assert.ok(element, 'element present');
  await act(async () => { element!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}
async function type(element: HTMLElement | null, value: string) {
  assert.ok(element, 'input present');
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
async function submit(element: HTMLElement | null) {
  assert.ok(element);
  await act(async () => { element!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const seals = Array.from({ length: 5 }, (_, i) => createHash('sha256').update(`e${i}`).digest('hex'));
const root5 = merkleRoot(seals);
const integrity = {
  status: 'intact', events: 5, verified: 5, pruned: 0, head: { seq: 5, hash: seals[4] }, firstBreak: null,
  archive: { status: 'consistent', archived: 5, unarchived: 0, firstMismatch: null },
  merkle: { root: root5, size: 5 }, checkedAt: '2026-11-10T10:00:00.000Z',
};
const proofFor = (seq: number, size = 5, root = merkleRoot(seals, size)) => ({
  eventId: `e${seq}`, seq, seal: seals[seq - 1], treeSize: size, root, proof: merkleInclusionProof(seals, seq - 1, size),
});

test('integrity panel: shows the Merkle checkpoint and proves an event in the browser', async () => {
  ui.handlers.getItsmAuditIntegrity = async () => integrity;
  ui.handlers.getItsmAuditProof = async (params: { event: string; treeSize: number }) => proofFor(Number(params.event), params.treeSize);
  const { container, unmount } = await mount(createElement(ui.AuditIntegrityPanel));
  await click(byTestId(container, 'button-check-integrity'));
  await settle();
  assert.equal(byTestId(container, 'status-audit-integrity')?.dataset.status, 'intact');
  assert.equal(byTestId(container, 'text-audit-archive')?.dataset.archive, 'consistent');
  assert.equal(byTestId(container, 'text-audit-checkpoint')?.textContent, `5:${root5}`);

  await type(byTestId(container, 'input-proof-event'), '3');
  await submit(byTestId(container, 'form-inclusion-proof'));
  await settle();
  const status = byTestId(container, 'status-inclusion-proof');
  assert.equal(status?.dataset.valid, 'true', status?.textContent ?? '');
  assert.match(status?.textContent ?? '', /n° 3 figure, inchangé/u);

  // A checkpoint kept earlier: the proof is asked for that size and checked against that root.
  await type(byTestId(container, 'input-proof-checkpoint'), `4:${merkleRoot(seals, 4)}`);
  await submit(byTestId(container, 'form-inclusion-proof'));
  await settle();
  assert.equal(byTestId(container, 'status-inclusion-proof')?.dataset.valid, 'true');
  assert.deepEqual(ui.calls.at(-1)?.args[0], { event: '3', treeSize: 4 });

  // A server answering with another root than the one kept is caught in the browser.
  ui.handlers.getItsmAuditProof = async () => ({ ...proofFor(3, 4), root: root5 });
  await submit(byTestId(container, 'form-inclusion-proof'));
  await settle();
  assert.equal(byTestId(container, 'status-inclusion-proof')?.dataset.valid, 'false');
  assert.match(byTestId(container, 'status-inclusion-proof')?.textContent ?? '', /réécrit/u);

  // A forged proof for the right root is refused too.
  ui.handlers.getItsmAuditProof = async () => ({ ...proofFor(3, 4), seal: seals[0] });
  await submit(byTestId(container, 'form-inclusion-proof'));
  await settle();
  assert.equal(byTestId(container, 'status-inclusion-proof')?.dataset.valid, 'false');

  await type(byTestId(container, 'input-proof-checkpoint'), 'pas un point de contrôle');
  await submit(byTestId(container, 'form-inclusion-proof'));
  await settle();
  assert.match(byTestId(container, 'status-inclusion-proof')?.textContent ?? '', /illisible/u);
  await unmount();
});

test('integrity panel: a broken chain is shown in red without a checkpoint, and an API failure is reported', async () => {
  ui.handlers.getItsmAuditIntegrity = async () => ({ ...integrity, status: 'broken', head: null, merkle: null, firstBreak: { seq: 2, eventId: 'e2', reason: 'Contenu modifié après scellement' } });
  const { container, unmount } = await mount(createElement(ui.AuditIntegrityPanel));
  await click(byTestId(container, 'button-check-integrity'));
  await settle();
  assert.equal(byTestId(container, 'status-audit-integrity')?.dataset.status, 'broken');
  assert.match(container.textContent ?? '', /Contenu modifié après scellement/u);
  assert.equal(byTestId(container, 'text-audit-checkpoint'), null);
  assert.equal(byTestId(container, 'form-inclusion-proof'), null);

  ui.handlers.getItsmAuditIntegrity = async () => { throw new Error('réseau'); };
  await click(byTestId(container, 'button-check-integrity'));
  await settle();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Vérification impossible/u);
  await unmount();
});

const stamp = (extra: Record<string, unknown> = {}) => ({
  id: 'ts-1', at: '2026-11-10T09:00:00.000Z', actor: 'user_a', size: 5, root: root5, statement: `anif-merkle-checkpoint:v1:5:${root5}`,
  tsaUrl: 'https://tsa.example', genTime: '2026-11-10T09:00:01.000Z', serial: '0a', policy: '1.2.3', tsaSubject: 'TSA test',
  valid: true, chainVerified: true, journalUnchanged: true, problem: null, ...extra,
});

test('timestamps panel: lists verified tokens, flags a rewritten journal, and N1/N3 can request one', async () => {
  let list = [stamp(), stamp({ id: 'ts-2', journalUnchanged: false, problem: 'Les événements horodatés ne donnent plus la même racine : le journal a été réécrit depuis.' })];
  ui.handlers.getItsmAuditTimestamps = async () => ({ configured: true, trustedRoots: 1, timestamps: list });
  ui.handlers.createItsmAuditTimestamp = async () => { list = [stamp({ id: 'ts-3' }), ...list]; return { size: 5, root: root5, genTime: '2026-11-10T10:00:00.000Z', serial: '0b', tsaSubject: 'TSA test', chainVerified: true }; };
  const { container, unmount } = await mount(createElement(ui.AuditTimestampsPanel, { canRequest: true }));
  await settle();
  assert.equal(byTestId(container, 'timestamp-ts-1')?.dataset.valid, 'true');
  assert.match(byTestId(container, 'timestamp-ts-1')?.textContent ?? '', /chaîne de l’autorité vérifiée/u);
  assert.equal(byTestId(container, 'timestamp-ts-2')?.dataset.valid, 'false');
  assert.match(byTestId(container, 'timestamp-ts-2')?.textContent ?? '', /réécrit/u);
  assert.equal(byTestId(container, 'link-timestamp-token-ts-1')?.getAttribute('href'), '/api/itsm/audit/timestamps/ts-1/token');

  await click(byTestId(container, 'button-request-timestamp'));
  await settle();
  assert.match(byTestId(container, 'status-timestamp-created')?.textContent ?? '', /5 événements horodaté/u);
  assert.ok(byTestId(container, 'timestamp-ts-3'), 'the list is reloaded');

  ui.handlers.createItsmAuditTimestamp = async () => { throw new Error('L’autorité d’horodatage n’a pas répondu.'); };
  await click(byTestId(container, 'button-request-timestamp'));
  await settle();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /n’a pas répondu/u);
  await unmount();
});

test('timestamps panel: auditors cannot request, and an unconfigured or untrusted authority is explained', async () => {
  ui.handlers.getItsmAuditTimestamps = async () => ({ configured: true, trustedRoots: 0, timestamps: [] });
  const auditor = await mount(createElement(ui.AuditTimestampsPanel, { canRequest: false }));
  await settle();
  assert.equal(byTestId(auditor.container, 'button-request-timestamp'), null);
  assert.match(auditor.container.textContent ?? '', /pas la chaîne de certificats/u);
  assert.match(auditor.container.textContent ?? '', /Aucun horodatage/u);
  await auditor.unmount();

  ui.handlers.getItsmAuditTimestamps = async () => ({ configured: false, trustedRoots: 0, timestamps: [] });
  const unconfigured = await mount(createElement(ui.AuditTimestampsPanel, { canRequest: true }));
  await settle();
  assert.match(unconfigured.container.textContent ?? '', /ITSM_TSA_URL/u);
  assert.equal(byTestId(unconfigured.container, 'button-request-timestamp'), null);
  await unconfigured.unmount();
});

test('SIEM panel: downloads every page in order and reports the chain state', async () => {
  const pages = [
    { body: '{"n":1}\n{"n":2}\n', next: '2', head: '3', chain: 'intact' },
    { body: '{"n":3}\n', next: '3', head: '3', chain: 'intact' },
  ];
  const requested: string[] = [];
  const saved: Blob[] = [];
  globalThis.fetch = (async (url: string) => {
    requested.push(url);
    const page = pages.shift()!;
    return new Response(page.body, { status: 200, headers: { 'X-ANIF-Next-After': page.next, 'X-ANIF-Journal-Head': page.head, 'X-ANIF-Chain-Status': page.chain } });
  }) as typeof fetch;
  Object.assign(URL, { createObjectURL: (blob: Blob) => { saved.push(blob); return 'blob:test'; }, revokeObjectURL: () => {} });
  window.HTMLAnchorElement.prototype.click = () => {};
  const { container, unmount } = await mount(createElement(ui.AuditSiemPanel));
  await click(byTestId(container, 'button-download-siem'));
  await settle();
  assert.deepEqual(requested, ['/api/itsm/audit/siem?after=0&limit=1000', '/api/itsm/audit/siem?after=2&limit=1000']);
  assert.match(byTestId(container, 'status-siem')?.textContent ?? '', /3 événement\(s\) exporté\(s\)\. Chaîne : intacte/u);
  assert.equal(await saved[0]!.text(), '{"n":1}\n{"n":2}\n{"n":3}\n');

  globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;
  await click(byTestId(container, 'button-download-siem'));
  await settle();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /ne permet pas d’exporter/u);
  await unmount();
});
