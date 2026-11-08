import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNameFor, firstNameFor } from '../src/lib/display-name.ts';

const id = 'user_3LmUjSSM4ppKElAXb0yhnveCpYw';

test('the Clerk full name is preferred over the technical identifier', () => {
  assert.equal(displayNameFor({ firstName: 'Awa', lastName: 'Mba', fullName: 'Awa Mba' }, id), 'Awa Mba');
  assert.equal(firstNameFor({ firstName: 'Awa', lastName: 'Mba' }, id), 'Awa');
});

test('without a name, the e-mail local part is used without its +tag', () => {
  const account = { primaryEmailAddress: { emailAddress: 'anif.recette+clerk_test@example.com' } };
  assert.equal(displayNameFor(account, id), 'anif.recette');
  assert.equal(firstNameFor(account, id), 'anif.recette');
});

test('the identifier remains the last resort', () => {
  assert.equal(displayNameFor(null, id), id);
  assert.equal(displayNameFor({ firstName: '  ', lastName: null }, id), id);
});

test('the watermark names the account, its address and the time to the second', async () => {
  const { watermarkText } = await import('../src/lib/watermark.ts');
  const text = watermarkText('Awa Mba', 'user_2abcdefghijklmnop', '41.158.1.2', Date.parse('2026-11-08T09:05:07.000Z'));
  assert.equal(text, 'Awa Mba · …ijklmnop · IP 41.158.1.2 · 08/11/2026 10:05:07');
  assert.equal(watermarkText('Awa', 'user_1', null, Date.parse('2026-11-08T09:05:07.000Z')), 'Awa · user_1 · 08/11/2026 10:05:07');
});
