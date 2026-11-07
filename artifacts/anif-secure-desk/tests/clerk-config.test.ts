import test from 'node:test';
import assert from 'node:assert/strict';
import { missingLocalClerkKey } from '../src/lib/clerk-config.ts';

test('a local host without a Clerk key is reported instead of rendering a blank page', () => {
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(missingLocalClerkKey(host, undefined), true, host);
    assert.equal(missingLocalClerkKey(host, '  '), true, host);
    assert.equal(missingLocalClerkKey(host, 'pk_test_abc'), false, host);
  }
});

test('deployed hosts keep Clerk host-based key derivation', () => {
  assert.equal(missingLocalClerkKey('anif.replit.app', undefined), false);
  assert.equal(missingLocalClerkKey('pilote.example.test', undefined), false);
  assert.equal(missingLocalClerkKey('localhost.example.test', undefined), false);
});
