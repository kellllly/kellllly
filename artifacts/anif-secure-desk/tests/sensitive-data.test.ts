import test from 'node:test';
import assert from 'node:assert/strict';
import { findSensitiveData } from '../src/lib/sensitive-data.ts';
import { browserLabel, formatEnvironment, workstationId } from '../src/lib/runtime-environment.ts';

const kinds = (...texts: string[]) => findSensitiveData(...texts).map((f) => f.kind);

test('nominative and financial data are detected and masked', () => {
  assert.deepEqual(kinds('Contacter awa.mba@example.ga demain'), ['Adresse e-mail']);
  assert.deepEqual(kinds('Virement vers GA21 4002 1001 0000 0000 0000 001'), ['IBAN']);
  assert.deepEqual(kinds('Carte 4111 1111 1111 1111 bloquée'), ['Numéro de carte bancaire']);
  assert.deepEqual(kinds('Appeler le +241 77 12 34 56'), ['Numéro de téléphone']);
  assert.deepEqual(kinds('Appeler le 07 12 34 56'), ['Numéro de téléphone']);
  assert.deepEqual(kinds('Titulaire né le 3 mars, passeport joint'), ['Mention d’identité (né le, passeport, CNI…)', 'Mention d’identité (né le, passeport, CNI…)']);
  const [finding] = findSensitiveData('awa.mba@example.ga');
  assert.equal(finding!.sample, 'aw…ga');
  assert.doesNotMatch(JSON.stringify(findSensitiveData('awa.mba@example.ga')), /awa\.mba/);
});

test('ordinary technical text passes', () => {
  assert.deepEqual(kinds('Imprimante PRN-204 hors ligne depuis 09:15, file bloquée sur le serveur SRV-12. Ticket INC-2422.'), []);
  assert.deepEqual(kinds('Erreur 1234567890123 au démarrage'), [], 'a number that fails the Luhn check is not a card');
});

test('the environment report is technical and the workstation id is stable', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const first = workstationId(storage);
  assert.match(first, /^POSTE-[0-9A-F]{8}$/);
  assert.equal(workstationId(storage), first);
  assert.equal(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), 'Chrome 141 · Windows');
  const text = formatEnvironment({ client: 'ANIF', browser: 'Chrome 141 · Windows', workstationId: first, memory: '8 Go', cores: '8', screen: '1920×1080', online: true, latencyMs: 42 });
  assert.match(text, /latence API 42 ms/);
  assert.match(text, new RegExp(`Poste : ${first}`));
});
