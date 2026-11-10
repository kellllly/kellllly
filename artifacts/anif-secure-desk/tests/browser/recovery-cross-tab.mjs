// Run with: ANIF_BASE_URL=https://<running-anif-host> node tests/browser/recovery-cross-tab.mjs
// Requires Playwright (`playwright` package + Chromium) and a running Vite app.
// All API traffic is intercepted; no shared server data is changed.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseURL = process.env.ANIF_BASE_URL;
if (!baseURL) throw new Error('Set ANIF_BASE_URL to the running ANIF app origin.');
const chromiumLaunchOptions = {
  headless: true,
  ...(process.env.ANIF_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.ANIF_CHROMIUM_EXECUTABLE }
    : {}),
};
const browser = await chromium.launch(chromiumLaunchOptions);
const context = await browser.newContext();
const seedPage = await context.newPage();
await seedPage.goto(baseURL);
const fixture = await seedPage.evaluate(async () => (await import('/src/lib/seed.ts')).migrate(null));
const clone = value => JSON.parse(JSON.stringify(value));
const shared = store => ({
  schema: store.schema, tickets: store.tickets, conversations: store.conversations,
  services: store.services, assets: store.assets, audit: store.audit,
  kedb: store.kedb, notifications: store.notifications, seeded: store.seeded,
});
const userId = `browser-recovery-${Date.now()}`;
const otherUserId = `${userId}-other-account`;
const key = `anif-sync-recovery-v1:${encodeURIComponent(userId)}`;
const otherUserKey = `anif-sync-recovery-v1:${encodeURIComponent(otherUserId)}`;
let remoteStore = clone(fixture);
let version = 1;
const puts = [];
let holdTargetTab = null;
let heldResolve;
let releaseHeldGet;
let heldGet = Promise.resolve();

await context.route('**/api/itsm', async route => {
  const request = route.request();
  if (request.method() === 'GET') {
    if (holdTargetTab && request.frame().page() === holdTargetTab) {
      holdTargetTab = null;
      heldResolve();
      await new Promise(resolve => { releaseHeldGet = resolve; });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: remoteStore, version }) });
  }
  if (request.method() === 'PUT') {
    const body = request.postDataJSON();
    puts.push(body);
    remoteStore = { ...remoteStore, ...body.store };
    version += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: remoteStore, version }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store: remoteStore, version }) });
});
await context.route('**/__recovery_harness*', route => route.fulfill({
  status: 200,
  contentType: 'text/html',
  body: `<!doctype html><html><head><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/tests/browser/recovery-harness.tsx"></script></body></html>`,
}));

const makeDraft = (title, base = shared(remoteStore)) => {
  const local = clone(base);
  local.tickets[0].title = title;
  return { draftId: `draft-${crypto.randomUUID()}`, base, local, remote: clone(remoteStore), version };
};
const writeDraft = async draft => {
  const storageKey = `${key}:draft:${encodeURIComponent(draft.draftId)}`;
  await seedPage.evaluate(([draftKey, value]) => localStorage.setItem(draftKey, JSON.stringify(value)), [storageKey, draft]);
  return storageKey;
};
const harnessURL = `/__recovery_harness?uid=${encodeURIComponent(userId)}`;
const title = page => page.getByTestId('canonical-ticket-title');
const resume = page => page.getByTestId('button-resume-sync');
const discard = page => page.getByTestId('button-discard-local-sync');
const pageA = seedPage;
const pageB = await context.newPage();
const pageC = await context.newPage();
let restartContext;
let restartProfileDir;

try {
  const discardedDraftKey = await writeDraft(makeDraft('LOCAL DISCARD CHANGE'));
  await pageA.goto(new URL(harnessURL, baseURL).href);
  await pageB.goto(new URL(harnessURL, baseURL).href);
  await resume(pageA).waitFor({ state: 'visible' });
  await resume(pageB).waitFor({ state: 'visible' });
  await discard(pageA).click();
  await resume(pageB).waitFor({ state: 'detached' });
  assert.equal(await pageA.evaluate(storageKey => localStorage.getItem(storageKey), discardedDraftKey), null);
  assert.equal(await title(pageB).innerText(), fixture.tickets[0].title);
  assert.equal(puts.length, 0);

  const resumedDraftKey = await writeDraft(makeDraft('LOCAL RESUME CHANGE'));
  await pageC.goto(new URL(`/__recovery_harness?uid=${encodeURIComponent(otherUserId)}`, baseURL).href);
  await title(pageC).waitFor({ state: 'visible' });
  await assert.rejects(resume(pageC).waitFor({ state: 'visible', timeout: 300 }));
  assert.equal(await title(pageC).innerText(), fixture.tickets[0].title);
  assert.equal(await pageC.getByTestId('recovered-local-edits').innerText(), '');
  assert.notEqual(await pageC.evaluate(storageKey => localStorage.getItem(storageKey), resumedDraftKey), null);
  assert.equal(await pageC.evaluate(storageKey => localStorage.getItem(storageKey), otherUserKey), null);

  await Promise.all([pageA.reload(), pageB.reload()]);
  await resume(pageA).waitFor({ state: 'visible' });
  await resume(pageB).waitFor({ state: 'visible' });
  assert.equal(await title(pageA).innerText(), fixture.tickets[0].title);
  assert.match(await pageA.getByTestId('recovered-local-edits').innerText(), /LOCAL RESUME CHANGE/);
  assert.match(await pageB.getByTestId('recovered-local-edits').innerText(), /LOCAL RESUME CHANGE/);
  assert.equal(puts.length, 0);
  await resume(pageA).click();
  await resume(pageA).waitFor({ state: 'detached' });
  await resume(pageB).waitFor({ state: 'detached' });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].store.tickets[0].title, 'LOCAL RESUME CHANGE');
  assert.equal(await title(pageB).innerText(), 'LOCAL RESUME CHANGE');
  assert.equal(await pageA.evaluate(storageKey => localStorage.getItem(storageKey), resumedDraftKey), null);
  await assert.rejects(resume(pageA).click({ timeout: 300 }));
  assert.equal(puts.length, 1);

  const thirdBase = shared(remoteStore);
  const delayedDraftKey = await writeDraft(makeDraft('DELAYED LOCAL CHANGE', thirdBase));
  await pageA.reload();
  await discard(pageA).waitFor({ state: 'visible' });
  heldGet = new Promise(resolve => { heldResolve = resolve; });
  holdTargetTab = pageB;
  const reloadB = pageB.reload();
  await heldGet;
  await discard(pageA).click();
  assert.equal(await pageA.evaluate(storageKey => localStorage.getItem(storageKey), delayedDraftKey), null);
  releaseHeldGet();
  await reloadB;
  await title(pageB).waitFor({ state: 'visible' });
  await resume(pageB).waitFor({ state: 'detached' });
  assert.equal(await title(pageB).innerText(), 'LOCAL RESUME CHANGE');
  assert.equal(await pageB.evaluate(storageKey => localStorage.getItem(storageKey), delayedDraftKey), null);
  assert.equal(puts.length, 1);

  const dualBase = shared(remoteStore);
  const tabADraft = makeDraft('INDEPENDENT CHANGE A', dualBase);
  const tabBDraft = makeDraft('INDEPENDENT CHANGE B', dualBase);
  const tabADraftKey = `${key}:draft:${encodeURIComponent(tabADraft.draftId)}`;
  const tabBDraftKey = `${key}:draft:${encodeURIComponent(tabBDraft.draftId)}`;
  await pageA.evaluate(([storageKey, value]) => localStorage.setItem(storageKey, JSON.stringify(value)), [tabADraftKey, tabADraft]);
  await pageB.evaluate(([storageKey, value]) => localStorage.setItem(storageKey, JSON.stringify(value)), [tabBDraftKey, tabBDraft]);
  await Promise.all([pageA.reload(), pageB.reload()]);
  await pageA.getByTestId('button-select-recovery-2').waitFor({ state: 'visible' });
  await pageB.getByTestId('button-select-recovery-2').waitFor({ state: 'visible' });
  await pageA.getByRole('button', { name: /INDEPENDENT CHANGE A/ }).click();
  await pageB.getByRole('button', { name: /INDEPENDENT CHANGE B/ }).click();
  assert.match(await pageA.getByTestId('recovered-local-edits').innerText(), /INDEPENDENT CHANGE A/);
  assert.match(await pageB.getByTestId('recovered-local-edits').innerText(), /INDEPENDENT CHANGE B/);
  await resume(pageA).click();
  await pageA.waitForFunction(storageKey => localStorage.getItem(storageKey) === null, tabADraftKey);
  assert.equal(await pageA.evaluate(storageKey => localStorage.getItem(storageKey), tabADraftKey), null);
  assert.notEqual(await pageA.evaluate(storageKey => localStorage.getItem(storageKey), tabBDraftKey), null);
  await discard(pageB).click();
  await pageB.getByTestId('button-discard-local-sync').waitFor({ state: 'detached' });
  assert.equal(await pageB.evaluate(storageKey => localStorage.getItem(storageKey), tabBDraftKey), null);
  assert.equal(puts.length, 2);

  // A persistent Chromium profile survives closing its browser process, unlike
  // the in-memory contexts used above to cover reloads and cross-tab behavior.
  restartProfileDir = await mkdtemp(join(tmpdir(), 'anif-recovery-browser-'));
  restartContext = await chromium.launchPersistentContext(restartProfileDir, chromiumLaunchOptions);
  await restartContext.route('**/api/itsm', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      puts.push(body);
      remoteStore = { ...remoteStore, ...body.store };
      version += 1;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ store: remoteStore, version }),
    });
  });
  await restartContext.route('**/__recovery_harness*', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><head><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/tests/browser/recovery-harness.tsx"></script></body></html>`,
  }));

  const restartDraft = makeDraft('AFTER BROWSER RESTART');
  const restartDraftKey = `${key}:draft:${encodeURIComponent(restartDraft.draftId)}`;
  const restartSeedPage = await restartContext.newPage();
  await restartSeedPage.goto(baseURL);
  await restartSeedPage.evaluate(([storageKey, value]) => localStorage.setItem(storageKey, JSON.stringify(value)), [restartDraftKey, restartDraft]);
  const remoteTitleBeforeRestart = remoteStore.tickets[0].title;
  const remoteVersionBeforeRestart = version;
  const putsBeforeRestart = puts.length;
  await restartContext.close();
  restartContext = undefined;

  // Relaunch Chromium against the exact same on-disk profile.
  restartContext = await chromium.launchPersistentContext(restartProfileDir, chromiumLaunchOptions);
  await restartContext.route('**/api/itsm', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      puts.push(body);
      remoteStore = { ...remoteStore, ...body.store };
      version += 1;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ store: remoteStore, version }),
    });
  });
  await restartContext.route('**/__recovery_harness*', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><head><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/tests/browser/recovery-harness.tsx"></script></body></html>`,
  }));
  const sameAccountPage = await restartContext.newPage();
  await sameAccountPage.goto(new URL(harnessURL, baseURL).href);
  await resume(sameAccountPage).waitFor({ state: 'visible' });
  assert.equal(await title(sameAccountPage).innerText(), remoteTitleBeforeRestart);
  assert.equal(await sameAccountPage.getByTestId('recovery-remote-version').innerText(), String(remoteVersionBeforeRestart));
  assert.match(await sameAccountPage.getByTestId('recovered-local-edits').innerText(), /AFTER BROWSER RESTART/);
  assert.notEqual(await sameAccountPage.evaluate(storageKey => localStorage.getItem(storageKey), restartDraftKey), null);
  assert.equal(puts.length, putsBeforeRestart);

  const otherAccountPage = await restartContext.newPage();
  await otherAccountPage.goto(new URL(`/__recovery_harness?uid=${encodeURIComponent(otherUserId)}`, baseURL).href);
  await title(otherAccountPage).waitFor({ state: 'visible' });
  await assert.rejects(resume(otherAccountPage).waitFor({ state: 'visible', timeout: 300 }));
  assert.equal(await title(otherAccountPage).innerText(), remoteTitleBeforeRestart);
  assert.equal(await otherAccountPage.getByTestId('recovery-remote-version').innerText(), '');
  assert.equal(await otherAccountPage.getByTestId('recovered-local-edits').innerText(), '');
  assert.notEqual(await otherAccountPage.evaluate(storageKey => localStorage.getItem(storageKey), restartDraftKey), null);
  assert.equal(await otherAccountPage.evaluate(storageKey => localStorage.getItem(storageKey), otherUserKey), null);
  assert.equal(puts.length, putsBeforeRestart);

  await resume(sameAccountPage).click();
  await resume(sameAccountPage).waitFor({ state: 'detached' });
  assert.equal(puts.length, putsBeforeRestart + 1);
  assert.equal(puts.at(-1).store.tickets[0].title, 'AFTER BROWSER RESTART');
  assert.equal(await sameAccountPage.evaluate(storageKey => localStorage.getItem(storageKey), restartDraftKey), null);
  console.log('PASS: same-account browser restart restores remote data and the local draft; another account sees no draft; no remote save occurs before explicit confirmation.');
} finally {
  if (restartContext) await restartContext.close();
  if (restartProfileDir) await rm(restartProfileDir, { recursive: true, force: true });
  await context.close();
  await browser.close();
}
