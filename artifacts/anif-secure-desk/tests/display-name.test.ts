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
