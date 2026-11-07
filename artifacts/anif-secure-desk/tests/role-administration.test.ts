import test from 'node:test';
import assert from 'node:assert/strict';
import { roleRequestError, roleServiceIds } from '../src/lib/role-administration.ts';

test('only N3 and N4 submit partial service scopes', () => {
  for (const role of ['N1', 'N2', 'N5', 'REVOKE']) {
    assert.deepEqual(roleServiceIds(role, ['old-service', 'example-service']), []);
  }
  for (const role of ['N3', 'N4']) {
    assert.deepEqual(roleServiceIds(role, [' service-a ', '', 'service-b', 'service-a']), ['service-a', 'service-b']);
    assert.deepEqual(roleServiceIds(role, []), []);
  }
});

test('lost mutation responses remain uncertain, never described as a confirmed failure or success', () => {
  for (const operation of ['assignment', 'attestation'] as const) {
    const message = roleRequestError(new TypeError('NetworkError when attempting to fetch resource.'), operation);
    assert.match(message, /incertain/);
    assert.match(message, /journal/);
    assert.match(message, /Aucune relance automatique/);
  }
});

test('read-only transport errors are translated without implying the archive is broken', () => {
  assert.match(roleRequestError(new TypeError('Failed to fetch'), 'archive'), /contrôle.*pas pu être confirmé/);
  assert.match(roleRequestError(new TypeError('Load failed'), 'directory'), /impossible de vérifier le compte/);
  assert.match(roleRequestError(new TypeError('Load failed'), 'directory'), /Aucune attribution ne peut être envoyée/);
  assert.match(roleRequestError(new DOMException('aborted', 'AbortError'), 'assignment'), /incertain/);
});

test('HTTP refusals keep their actionable server explanation', () => {
  const error = Object.assign(new Error('HTTP 400 : Services autorisés introuvables.'), { status: 400 });
  assert.equal(roleRequestError(error, 'assignment'), error.message);
  const disappearedService = Object.assign(
    new Error('HTTP 400 Bad Request: Un ou plusieurs services autorisés sont introuvables dans le pilote.'),
    { status: 400 },
  );
  assert.match(roleRequestError(disappearedService, 'assignment'), /service sélectionné n’est plus présent/);
  assert.match(roleRequestError(disappearedService, 'assignment'), /Le rôle n’a pas été modifié/);
  assert.match(roleRequestError(null, 'directory'), /n’a pas pu terminer/);
});

test('expired or demoted sessions get clear role-assignment errors', () => {
  const expiredSession = Object.assign(new Error('HTTP 401 Unauthorized'), { status: 401 });
  assert.match(roleRequestError(expiredSession, 'assignment'), /session a expiré/);
  assert.match(roleRequestError(expiredSession, 'assignment'), /rôle n’a pas été modifié/);

  const demotedSession = Object.assign(new Error('HTTP 403 Forbidden'), {
    status: 403,
    data: { error: 'Votre rôle N1 a changé; reconnectez-vous avant de gérer les habilitations.' },
  });
  assert.match(roleRequestError(demotedSession, 'assignment'), /Votre rôle N1 a changé/);
  assert.match(roleRequestError(demotedSession, 'assignment'), /rôle n’a pas été modifié/);

  const genericDenial = Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 });
  assert.match(roleRequestError(genericDenial, 'assignment'), /vérifiez votre accès N1/);
});

test('directory service outages explain that accounts cannot be verified or assigned', () => {
  const error = Object.assign(new Error('HTTP 503 : Impossible de charger le répertoire.'), { status: 503 });
  const message = roleRequestError(error, 'directory');
  assert.match(message, /répertoire des comptes est temporairement indisponible/);
  assert.match(message, /compte ne peut pas être vérifié/);
  assert.match(message, /aucune attribution ne peut être envoyée/);
});
