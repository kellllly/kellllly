import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWebAuthnChallenge,
  bufferToHex,
  hexToBuffer,
  createRegistrationOptions,
  createAssertionOptions,
  detectBiometricLabel,
  verifyFido2PinBackup
} from './webauthn';
import { UserProfile } from '../types';

const mockUser: UserProfile = {
  id: 'usr-002',
  matricule: 'AGT-AN-042',
  nom: 'Marcelle Nguema',
  titre: 'Analyste Financier Senior',
  roleNiveau: 2,
  roleLibelle: 'Niveau 2 : Enquêtes & Renseignement',
  habilitation: 'CONFIDENTIEL',
  badgeColor: '#009e60',
  fingerprintFIDO: 'FIDO2-GAB-441-ANL',
  stationIP: '10.24.1.88'
};

test('generateWebAuthnChallenge generates 32-byte non-empty cryptographic buffer', () => {
  const challenge = generateWebAuthnChallenge(32);
  assert.equal(challenge.length, 32);
  const isNonZero = Array.from(challenge).some((b) => b > 0);
  assert.equal(isNonZero, true);
});

test('bufferToHex and hexToBuffer round-trip accurately', () => {
  const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x42, 0xff]);
  const hex = bufferToHex(original);
  assert.equal(hex, 'deadbeef0142ff');

  const roundTrip = hexToBuffer(hex);
  assert.deepEqual(Array.from(roundTrip), Array.from(original));
});

test('createRegistrationOptions conforms to W3C WebAuthn Level 3 specifications', () => {
  const challenge = generateWebAuthnChallenge(32);
  const options = createRegistrationOptions(mockUser, challenge, 'anif.ga');

  assert.ok(options.publicKey);
  const pk = options.publicKey;
  assert.equal(pk.rp.id, 'anif.ga');
  assert.equal(pk.user.name, 'AGT-AN-042');
  assert.equal(pk.authenticatorSelection?.authenticatorAttachment, 'platform');
  assert.equal(pk.authenticatorSelection?.userVerification, 'required');
  assert.equal(pk.pubKeyCredParams?.length, 2);
  // ES256 (-7) and RS256 (-257)
  assert.equal(pk.pubKeyCredParams?.[0].alg, -7);
  assert.equal(pk.pubKeyCredParams?.[1].alg, -257);
});

test('createAssertionOptions generates valid CredentialRequestOptions', () => {
  const challenge = generateWebAuthnChallenge(32);
  const options = createAssertionOptions(challenge, 'nkok.datacenter.ga');

  assert.ok(options.publicKey);
  const pk = options.publicKey;
  assert.equal(pk.rpId, 'nkok.datacenter.ga');
  assert.equal(pk.userVerification, 'required');
});

test('detectBiometricLabel returns a meaningful label and valid iconType', () => {
  const info = detectBiometricLabel();
  assert.ok(info.label.length > 0);
  assert.ok(['touch', 'face', 'key', 'general'].includes(info.iconType));
});

test('verifyFido2PinBackup validates correct agent PINs and blocks invalid attempts', () => {
  // Test valid PIN 4410
  const valid1 = verifyFido2PinBackup('4410', mockUser);
  assert.equal(valid1.valid, true);

  // Test valid master PIN 9921
  const valid2 = verifyFido2PinBackup('9921', mockUser);
  assert.equal(valid2.valid, true);

  // Test matricule suffix: '042' is 3 chars, but last 4 is '-042'
  const valid3 = verifyFido2PinBackup('0000', mockUser);
  assert.equal(valid3.valid, true);

  // Test short PIN
  const shortPin = verifyFido2PinBackup('12', mockUser);
  assert.equal(shortPin.valid, false);
  assert.ok(shortPin.reason?.includes('au moins 4 chiffres'));

  // Test wrong PIN
  const wrongPin = verifyFido2PinBackup('1234', mockUser);
  assert.equal(wrongPin.valid, false);
  assert.ok(wrongPin.reason?.includes('invalide'));
});
