import test from 'node:test';
import assert from 'node:assert/strict';
import { roleRequestError, roleServiceIds } from '../src/lib/role-administration.ts';

test('only N3 and N4 submit partial service scopes', () => {
  for (const role of ['N1', 'N2', 'N5', 'REVOKE']) {
    assert.deepEqual(roleServiceIds(role, 'old-service, example-service'), []);
  }
  for (const role of ['N3', 'N4']) {
    assert.deepEqual(roleServiceIds(role, ' service-a, , service-b, service-a '), ['service-a', 'service-b']);
    assert.deepEqual(roleServiceIds(role, ''), []);
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
  assert.match(roleRequestError(new TypeError('Load failed'), 'directory'), /données.*anciennes/);
  assert.match(roleRequestError(new DOMException('aborted', 'AbortError'), 'assignment'), /incertain/);
});

test('HTTP refusals keep their actionable server explanation', () => {
  const error = Object.assign(new Error('HTTP 400 : Services autorisés introuvables.'), { status: 400 });
  assert.equal(roleRequestError(error, 'assignment'), error.message);
  assert.match(roleRequestError(null, 'directory'), /n’a pas pu terminer/);
});
