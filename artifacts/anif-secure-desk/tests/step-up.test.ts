import test from 'node:test';
import assert from 'node:assert/strict';
import { isStepUpHint, reverificationHintOf, stepUpMessage, withStepUpHint } from '../src/lib/step-up.ts';

const hint = { clerk_error: { type: 'forbidden', reason: 'reverification-error' }, error: 'Confirmez votre identité' };
const apiError = (status: number, data: unknown) => Object.assign(new Error('refus'), { status, data });

test('a reverification refusal from the API is handed to Clerk as its hint, other errors still throw', async () => {
  const refused = withStepUpHint(async () => { throw apiError(403, hint); });
  const result = await refused();
  assert.ok(isStepUpHint(result));
  assert.deepEqual(reverificationHintOf(apiError(403, hint)), hint);

  const other = withStepUpHint(async () => { throw apiError(403, { error: 'Réservé aux N1' }); });
  await assert.rejects(other(), /refus/u);
  assert.equal(reverificationHintOf(apiError(403, { clerk_error: { type: 'forbidden', reason: 'autre' } })), null);

  const ok = withStepUpHint(async (value: number) => value * 2);
  assert.equal(await ok(21), 42);
});

test('a cancelled dialog and a missing second factor get a clear message', () => {
  assert.match(stepUpMessage(Object.assign(new Error('x'), { code: 'reverification_cancelled' })) ?? '', /annulée/u);
  assert.match(stepUpMessage(apiError(403, { code: 'second_factor_required', error: 'Activez un second facteur' })) ?? '', /second facteur/u);
  assert.equal(stepUpMessage(new Error('autre')), null);
});
