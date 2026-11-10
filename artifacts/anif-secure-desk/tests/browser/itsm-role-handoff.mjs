// Run from the Clerk E2E runner with its signInClerkUser helper:
//   runItsmRoleHandoffBrowserTest({ signInClerkUser, newBrowserContext })
//
// Required non-secret environment values:
//   ANIF_BASE_URL, ANIF_E2E_N1_EMAIL, ANIF_E2E_SECOND_N1_EMAIL,
//   ANIF_E2E_NON_N1_EMAIL, ANIF_E2E_TARGET_EMAIL
//
// The account directory and its access checks use the real API. The role PUT is
// intercepted for the regular role-edit assertions. The dedicated two-N1
// revocation scenario below writes to Clerk and the role archive, then restores
// the original N1 role; use dedicated E2E accounts only.
const directoryPath = '/api/itsm/users';
const rolePath = userId => `/api/itsm/users/${userId}/role`;

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the ITSM role handoff browser test.`);
  return value;
}

function isDirectoryRequest(request, url) {
  return request.method() === 'GET' && url.pathname === directoryPath;
}

/**
 * Exercise N1 account search/selection and role display with a real Clerk
 * session, then verify that a non-N1 session is denied by the real API.
 *
 * signInClerkUser is provided by the Clerk E2E runner; this module deliberately
 * does not implement or interact with Clerk's sign-in UI.
 */
export async function runItsmRoleHandoffBrowserTest({ signInClerkUser, newBrowserContext }) {
  if (typeof signInClerkUser !== 'function') {
    throw new TypeError('Pass the signInClerkUser helper from the Clerk E2E runner.');
  }
  if (typeof newBrowserContext !== 'function') {
    throw new TypeError('Pass the newBrowserContext helper from the Clerk E2E runner.');
  }

  const baseURL = requiredSetting('ANIF_BASE_URL');
  const n1Email = requiredSetting('ANIF_E2E_N1_EMAIL');
  const secondN1Email = requiredSetting('ANIF_E2E_SECOND_N1_EMAIL');
  const nonN1Email = requiredSetting('ANIF_E2E_NON_N1_EMAIL');
  const targetEmail = requiredSetting('ANIF_E2E_TARGET_EMAIL');
  assert(secondN1Email.toLowerCase() !== n1Email.toLowerCase(),
    'The second N1 session must belong to a different account.');
  const appUrl = new URL(baseURL);
  const basePath = appUrl.pathname.replace(/\/+$/, '') || '/';
  const settingsURL = new URL('settings', appUrl.href.endsWith('/') ? appUrl : `${appUrl.href}/`).href;

  async function openSettings(email) {
    const context = await newBrowserContext({});
    const page = await context.newPage();
    const signInUrl = await signInClerkUser({
      firstName: 'ANIF',
      lastName: 'Test',
      email,
      basePath,
    });
    await page.goto(signInUrl);
    return { context, page };
  }

  const { context, page } = await openSettings(n1Email);
  let secondN1Context;
  let secondN1Page;
  let demotedAccount;
  try {
      const directoryQueries = [];
      const changedRoles = new Map();
      let directoryFailureMode = null;
      let assignmentFailureStatus = null;
      let assignmentBody;
      let assignmentPath;

      await page.route(url => {
        try {
          return new URL(url).pathname === directoryPath;
        } catch {
          return false;
        }
      }, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const url = new URL(route.request().url());
        directoryQueries.push({
          q: url.searchParams.get('q') ?? '',
          limit: Number(url.searchParams.get('limit') ?? 10),
          offset: Number(url.searchParams.get('offset') ?? 0),
        });
        const failureMode = directoryFailureMode;
        directoryFailureMode = null;
        if (failureMode === '503') {
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Impossible de charger le répertoire des comptes du pilote.' }),
          });
        }
        if (failureMode === 'network') return route.abort('failed');
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const result = await response.json();
        for (const account of result.accounts ?? []) {
          if (changedRoles.has(account.userId)) account.role = changedRoles.get(account.userId);
        }
        return route.fulfill({ response, json: result });
      });

      await page.route(url => {
        try {
          return /\/api\/itsm\/users\/[^/]+\/role$/.test(new URL(url).pathname);
        } catch {
          return false;
        }
      }, async route => {
        const request = route.request();
        if (request.method() !== 'PUT') return route.continue();
        assignmentPath = new URL(request.url()).pathname;
        assignmentBody = request.postDataJSON();
        const userId = assignmentPath.match(/\/users\/([^/]+)\/role$/)?.[1];
        assert(userId, 'The role request must name its selected account.');
        const failureStatus = assignmentFailureStatus;
        assertEqual(assignmentBody.role, failureStatus ? 'N3' : 'N2',
          'The request must contain the role selected for this assignment.');
        assertEqual(JSON.stringify(assignmentBody.serviceIds), '[]', 'N2 must have an empty service scope.');
        assignmentFailureStatus = null;
        if (failureStatus) {
          return route.fulfill({
            status: failureStatus,
            contentType: 'application/json',
            body: JSON.stringify({
              error: failureStatus === 401
                ? 'Session expirée.'
                : 'Votre rôle N1 a changé; reconnectez-vous avant de gérer les habilitations.',
            }),
          });
        }
        changedRoles.set(decodeURIComponent(userId), 'N2');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            userId: decodeURIComponent(userId),
            role: 'N2',
            label: 'Analyste',
            serviceIds: [],
          }),
        });
      });

      const initialPage = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && (url.searchParams.get('offset') ?? '0') === '0';
      });
      await page.goto(settingsURL);
      const initialResponse = await initialPage;
      assertEqual(initialResponse.status(), 200, 'An N1 session must load the protected directory.');
      const firstPage = await initialResponse.json();
      assert(firstPage.totalCount > firstPage.limit, 'The N1 test directory must contain more than one page.');
      assert(await page.getByRole('heading', { name: 'Attribuer un rôle au pilote' }).isVisible(),
        'N1 must see the role assignment section.');

      const nextPageResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('offset') === String(firstPage.limit);
      });
      await page.getByRole('button', { name: 'Page suivante' }).click();
      const nextResponse = await nextPageResponse;
      assertEqual(nextResponse.status(), 200, 'The next directory page must load.');
      assert(directoryQueries.some(query => query.offset === firstPage.limit), 'The next page offset must be requested.');

      const searchResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('q') === targetEmail;
      });
      await page.getByPlaceholder('E-mail ou identifiant de compte').fill(targetEmail);
      const searchedResponse = await searchResponse;
      assertEqual(searchedResponse.status(), 200, 'Searching the N1 directory must succeed.');

      const accounts = page.locator('[aria-label="Comptes du pilote"]');
      const targetRow = accounts.locator('button').filter({ hasText: targetEmail });
      assertEqual(await targetRow.count(), 1, 'The searched test account must appear once.');
      const targetId = await targetRow.locator('span.mono').innerText();
      const previousRole = await targetRow.locator('span.rounded-md').innerText();
      assert(previousRole !== 'N1', 'The target must not be an N1 account.');
      assert(previousRole !== 'N2', 'The target must start with a different role.');
      await targetRow.click();

      changedRoles.set(targetId, 'N1');
      await targetRow.locator('span.rounded-md').getByText('N1', { exact: true }).waitFor({ timeout: 25_000 });
      changedRoles.set(targetId, previousRole);

      const mutations = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/itsm')
          && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          mutations.push({ method: request.method(), path: url.pathname });
        }
      });
      const refreshedResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('q') === targetEmail;
      });
      await page.getByLabel('Nouvelle habilitation').selectOption('N2');
      await page.getByRole('button', { name: 'Attribuer le rôle' }).click();
      await page.getByRole('status').filter({ hasText: `Rôle N2 attribué au compte ${targetId}.` }).waitFor();
      const refreshed = await refreshedResponse;
      assertEqual(refreshed.status(), 200, 'The refreshed directory query must succeed.');
      await targetRow.locator('span.rounded-md').getByText('N2', { exact: true }).waitFor();

      assertEqual(assignmentPath, rolePath(targetId), 'The selected account must receive the role request.');
      assertEqual(Object.keys(assignmentBody).sort().join(','), 'role,serviceIds',
        'The role request must contain only the expected fields.');
      assertEqual(assignmentBody.role, 'N2', 'The selected account must receive the requested role.');
      assertEqual(JSON.stringify(assignmentBody.serviceIds), '[]', 'The selected account must receive the empty scope.');
      assertEqual(JSON.stringify(mutations), JSON.stringify([{ method: 'PUT', path: rolePath(targetId) }]),
        'Role assignment must not send a workspace or alternative mutation.');
      assert(directoryQueries.some(query => query.q === targetEmail),
        'The directory API must receive the account search.');

      for (const status of [401, 403]) {
        await targetRow.click();
        await page.getByLabel('Nouvelle habilitation').selectOption('N3');
        assignmentFailureStatus = status;
        const refusedAssignment = page.waitForResponse(response => {
          const url = new URL(response.url());
          return response.request().method() === 'PUT'
            && url.pathname === rolePath(targetId)
            && response.status() === status;
        });
        await page.getByRole('button', { name: 'Attribuer le rôle' }).click();
        await refusedAssignment;
        const assignmentAlert = page.getByTestId('status-role-assignment-error');
        await assignmentAlert.waitFor();
        if (status === 401) {
          assert.match(await assignmentAlert.innerText(), /session a expiré/i,
            'An expired session must show a clear reauthentication error.');
        } else {
          assert.match(await assignmentAlert.innerText(), /rôle N1 a changé/i,
            'A demoted N1 must see the server explanation.');
          assert.match(await assignmentAlert.innerText(), /rôle n’a pas été modifié/i,
            'A denied assignment must explain that the role stayed unchanged.');
        }
        assertEqual(await targetRow.locator('span.rounded-md').innerText(), 'N2',
          `A ${status} assignment response must leave the displayed role unchanged.`);
      }
      assertEqual(JSON.stringify(mutations), JSON.stringify([
        { method: 'PUT', path: rolePath(targetId) },
        { method: 'PUT', path: rolePath(targetId) },
        { method: 'PUT', path: rolePath(targetId) },
      ]), '401/403 assignment refusals must not trigger a workspace or alternative mutation.');

      const assignmentCountBeforeOutages = mutations.length;
      await targetRow.click();
      directoryFailureMode = '503';
      const unavailableResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('q') === targetEmail
          && response.status() === 503;
      });
      await page.getByRole('button', { name: 'Actualiser' }).click();
      await unavailableResponse;
      const directoryAlert = page.getByRole('alert').filter({ hasText: 'Le répertoire des comptes est temporairement indisponible' });
      await directoryAlert.waitFor();
      assertEqual(await targetRow.count(), 0, 'Accounts from an unsuccessful directory response must not remain visible.');
      assert(await page.getByRole('button', { name: 'Attribuer le rôle' }).isDisabled(),
        'Role assignment must be disabled when the account cannot be verified.');
      assertEqual(mutations.length, assignmentCountBeforeOutages,
        'A 503 directory response must not trigger another role assignment.');

      directoryFailureMode = 'network';
      const networkFailure = page.waitForEvent('requestfailed', request => {
        const url = new URL(request.url());
        return isDirectoryRequest(request, url) && url.searchParams.get('q') === targetEmail;
      });
      await page.getByRole('button', { name: 'Actualiser' }).click();
      await networkFailure;
      await page.getByRole('alert').filter({ hasText: 'impossible de vérifier le compte' }).waitFor();
      assert(await page.getByRole('button', { name: 'Attribuer le rôle' }).isDisabled(),
        'Role assignment must remain disabled after a directory network failure.');
      assertEqual(mutations.length, assignmentCountBeforeOutages,
        'A network failure must not trigger a role assignment.');

      const ownDirectoryResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('q') === n1Email
          && response.status() === 200;
      });
      await page.getByPlaceholder('E-mail ou identifiant de compte').fill(n1Email);
      await ownDirectoryResponse;
      const ownRow = accounts.locator('button').filter({ hasText: n1Email });
      await ownRow.waitFor();
      const ownUserId = await ownRow.locator('span.mono').innerText();
      await ownRow.click();
      assertEqual(await page.locator('form').getByText(ownUserId, { exact: true }).count(), 1,
        'The first N1 session must have a selected account before its role changes.');

      secondN1Context = await newBrowserContext({});
      secondN1Page = await secondN1Context.newPage();
      const secondSignInUrl = await signInClerkUser({
        firstName: 'ANIF',
        lastName: 'Test',
        email: secondN1Email,
        basePath,
      });
      await secondN1Page.goto(secondSignInUrl);
      await secondN1Page.goto(settingsURL);
      await secondN1Page.getByRole('heading', { name: 'Attribuer un rôle au pilote' }).waitFor();

      const ownAccountBeforeChange = await secondN1Page.evaluate(async email => {
        const params = new URLSearchParams({ q: email, limit: '10', offset: '0' });
        const response = await fetch(`/api/itsm/users?${params}`, { credentials: 'same-origin' });
        return { status: response.status, body: await response.json() };
      }, n1Email);
      assertEqual(ownAccountBeforeChange.status, 200,
        'The second N1 session must be able to load the protected directory.');
      demotedAccount = ownAccountBeforeChange.body.accounts?.find(account => account.userId === ownUserId);
      assert(demotedAccount, 'The second N1 session must find the first session account.');
      assertEqual(demotedAccount.role, 'N1', 'The first session account must start as N1.');

      const demotionResponse = await secondN1Page.evaluate(async userId => {
        const response = await fetch(`/api/itsm/users/${encodeURIComponent(userId)}/role`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'N5', serviceIds: [] }),
        });
        return { status: response.status, body: await response.json() };
      }, ownUserId);
      assertEqual(demotionResponse.status, 200,
        'The second N1 session must demote the first account through the real API.');
      assertEqual(demotionResponse.body.role, 'N5',
        'The real API must confirm the first account was demoted to N5.');

      const revokedDirectoryResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return isDirectoryRequest(response.request(), url)
          && url.searchParams.get('q') === n1Email
          && response.status() === 403;
      });
      await page.getByRole('button', { name: 'Actualiser' }).click();
      const deniedDirectory = await revokedDirectoryResponse;
      const deniedBody = await deniedDirectory.json();
      assert(!('accounts' in deniedBody),
        'A demoted N1 directory response must not include account metadata.');
      await page.getByRole('alert').filter({ hasText: 'Votre accès N1 a changé' }).waitFor();
      assertEqual(await page.getByRole('heading', { name: 'Attribuer un rôle au pilote' }).count(), 0,
        'A demoted session must hide the account directory after its next authorization response.');
      assertEqual(await page.getByPlaceholder('E-mail ou identifiant de compte').count(), 0,
        'A demoted session must hide directory search after its next authorization response.');
      assertEqual(await page.getByText(n1Email, { exact: true }).count(), 0,
        'A demoted session must not keep the loaded account email visible.');
      assertEqual(await page.getByText(ownUserId, { exact: true }).count(), 0,
        'A demoted session must not keep the selected account ID visible.');
  } finally {
    try {
      if (secondN1Page && demotedAccount) {
        const currentAccount = await secondN1Page.evaluate(async email => {
          const params = new URLSearchParams({ q: email, limit: '10', offset: '0' });
          const response = await fetch(`/api/itsm/users?${params}`, { credentials: 'same-origin' });
          return { status: response.status, body: await response.json() };
        }, n1Email);
        if (currentAccount.status !== 200) {
          throw new Error(`Could not verify the E2E account role during cleanup (HTTP ${currentAccount.status}).`);
        }
        const account = currentAccount.body.accounts?.find(item => item.userId === demotedAccount.userId);
        if (!account) throw new Error('Could not find the E2E account during role restoration.');
        if (account.role !== demotedAccount.role
          || JSON.stringify(account.serviceIds) !== JSON.stringify(demotedAccount.serviceIds)) {
          const restoration = await secondN1Page.evaluate(async ({ userId, role, serviceIds }) => {
            const response = await fetch(`/api/itsm/users/${encodeURIComponent(userId)}/role`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ role, serviceIds }),
            });
            return { status: response.status, body: await response.json() };
          }, {
            userId: demotedAccount.userId,
            role: demotedAccount.role,
            serviceIds: demotedAccount.serviceIds,
          });
          if (restoration.status !== 200) {
            throw new Error(`Could not restore the E2E account role (HTTP ${restoration.status}).`);
          }
        }
      }
    } finally {
      await secondN1Context?.close();
      await context.close();
    }
  }

  const { context: nonN1Context, page: nonN1Page } = await openSettings(nonN1Email);
  try {
      const directoryResponses = [];
      nonN1Page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname === directoryPath) directoryResponses.push(response);
      });
      await nonN1Page.goto(settingsURL);
      await nonN1Page.getByText(/ · N[2-5] · /).waitFor();
      assertEqual(await nonN1Page.getByRole('heading', { name: 'Attribuer un rôle au pilote' }).count(), 0,
        'A non-N1 must not see the role assignment section.');
      assertEqual(await nonN1Page.getByPlaceholder('E-mail ou identifiant de compte').count(), 0,
        'A non-N1 must not see the directory search.');
      assertEqual(directoryResponses.length, 0, 'A non-N1 settings page must not request the account directory.');

      const denied = await nonN1Page.evaluate(async () => {
        const response = await fetch('/api/itsm/users', { credentials: 'same-origin' });
        return { status: response.status, body: await response.json() };
      });
      assertEqual(denied.status, 403, 'The real API must deny a non-N1 directory request.');
      assert(!('accounts' in denied.body), 'A denied response must not expose accounts.');
      assertEqual(await nonN1Page.getByText(targetEmail, { exact: true }).count(), 0,
        'A non-N1 page must not display the searched account.');
      assertEqual(directoryResponses.length, 1, 'Only the explicit denied request should reach the directory route.');
      assertEqual(directoryResponses[0]?.status(), 403, 'The direct directory request must receive 403.');
  } finally {
    await nonN1Context.close();
  }
}
