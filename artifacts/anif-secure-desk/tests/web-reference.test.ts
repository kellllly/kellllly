import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAddWebReference,
  parseWebReferenceUpdate,
  shortUrl,
  webReferenceErrorMessage,
  webReferenceUrlProblem,
} from '../src/lib/web-reference.ts';

// Same layout as webReferenceUpdateBody() in the API (artifacts/api-server/src/lib/itsm-web-reference.ts).
const body = [
  'Référence web ajoutée : Connecteur SMTP 4.2 : correctif 4.2.1',
  'Source : https://support.editeur.example/kb/4812',
  'Note : À confirmer sur notre version.',
  '',
  'Extrait récupéré automatiquement (contenu externe, non vérifié) :',
  '',
  'Après la mise à jour 4.2, les envois sont refusés.',
  '',
  'Correctif : installer 4.2.1.',
].join('\n');

test('a web reference update is read back into its parts', () => {
  assert.deepEqual(parseWebReferenceUpdate(body), {
    title: 'Connecteur SMTP 4.2 : correctif 4.2.1',
    url: 'https://support.editeur.example/kb/4812',
    note: 'À confirmer sur notre version.',
    excerpt: 'Après la mise à jour 4.2, les envois sont refusés.\n\nCorrectif : installer 4.2.1.',
  });
  const withoutNote = body.replace('Note : À confirmer sur notre version.\n', '');
  assert.equal(parseWebReferenceUpdate(withoutNote)?.note, null);
});

test('ordinary or forged updates are not shown as web references', () => {
  assert.equal(parseWebReferenceUpdate('Traitement démarré.'), null);
  assert.equal(parseWebReferenceUpdate('Référence web ajoutée : X\nSource : javascript:alert(1)'), null);
  assert.equal(parseWebReferenceUpdate('Référence web ajoutée : X\nSource : http://site.example/'), null);
  assert.equal(parseWebReferenceUpdate('Référence web ajoutée : X\nPas de source'), null);
});

test('only N3 and N4 can add a reference, and only to an open ticket', () => {
  assert.equal(canAddWebReference('N3', { status: 'En cours' }), true);
  assert.equal(canAddWebReference('N4', { status: 'Nouveau' }), true);
  for (const role of ['N1', 'N2', 'N5']) assert.equal(canAddWebReference(role, { status: 'En cours' }), false);
  assert.equal(canAddWebReference('N3', { status: 'Clos' }), false);
  assert.equal(canAddWebReference('N3', { status: 'Rejeté' }), false);
});

test('the form flags missing or non-https addresses before calling the API', () => {
  assert.equal(webReferenceUrlProblem('https://support.editeur.example/kb/1'), null);
  assert.match(webReferenceUrlProblem('') ?? '', /Indiquez/);
  assert.match(webReferenceUrlProblem('http://site.example') ?? '', /https/);
  assert.match(webReferenceUrlProblem('pas une adresse') ?? '', /invalide/);
  assert.equal(shortUrl('https://support.editeur.example/kb/1/'), 'support.editeur.example/kb/1');
});

test('API refusals surface their own message', () => {
  assert.equal(webReferenceErrorMessage({ status: 400, data: { error: 'Seules les pages publiques en https sont acceptées.' } }), 'Seules les pages publiques en https sont acceptées.');
  assert.match(webReferenceErrorMessage({ status: 504, data: null }), /à temps/);
  assert.match(webReferenceErrorMessage(new TypeError('Failed to fetch')), /connexion/);
});
