import test from 'node:test';
import assert from 'node:assert/strict';
import { saveRefusalOutcome, SUSPENDED_EDIT_MESSAGE } from '../src/lib/save-refusal.ts';

test('a server refusal followed by a successful reload resumes writes and keeps the reason', () => {
  const error = Object.assign(new Error('HTTP 400 Bad Request'), {
    status: 400,
    data: { error: 'Documentez la cause racine et la solution (10 caractères minimum).' },
  });
  const outcome = saveRefusalOutcome(error, true);
  assert.equal(outcome.resumeWrites, true);
  assert.match(outcome.message, /Documentez la cause racine/);
  assert.match(outcome.message, /rechargé/);
});

test('a refusal without a fresh snapshot keeps writes suspended and offers resynchronization', () => {
  const outcome = saveRefusalOutcome(new TypeError('Failed to fetch'), false);
  assert.equal(outcome.resumeWrites, false);
  assert.match(outcome.message, /Failed to fetch/);
  assert.match(outcome.message, /Resynchroniser/);
});

test('an unknown failure still produces an actionable message', () => {
  assert.match(saveRefusalOutcome(null, true).message, /n’a pas confirmé/);
  assert.match(SUSPENDED_EDIT_MESSAGE, /n’a pas été appliquée/);
});
