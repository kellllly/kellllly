import { test } from 'node:test';
import assert from 'node:assert';
import {
  escapeCsvField,
  computeCumulativeMerkleRoot,
  generateSignedAuditCsv,
  verifySignedAuditCsv
} from './wormExport';
import { AuditEntry, UserProfile } from '../types';
import { WebAuthnAssertionResult } from './webauthn';

const mockUser: UserProfile = {
  id: 'usr-42',
  matricule: 'AGT-AN-042',
  nom: 'Marcelle Nguema',
  titre: 'Analyste Financier Senior',
  roleNiveau: 2,
  roleLibelle: 'Analyste Senior',
  habilitation: 'CONFIDENTIEL',
  badgeColor: 'emerald',
  fingerprintFIDO: 'FIDO2-GAB-441-ANL',
  stationIP: '10.24.1.88'
};

const mockLogs: AuditEntry[] = [
  {
    index: 1,
    id: 'AUD-001',
    timestampRFC3161: '2026-11-08 12:00:00 UTC [RFC 3161]',
    action: 'INITIALISATION_REGISTRE',
    acteur: 'SYS-ROOT',
    roleNiveau: 1,
    details: 'Initialisation de l\'enclave WORM Nkok',
    hachagePrecedent: '0000000000000000000000000000000000000000000000000000000000000000',
    hachageActuel: '1111111111111111111111111111111111111111111111111111111111111111',
    estValide: true
  },
  {
    index: 2,
    id: 'AUD-002',
    timestampRFC3161: '2026-11-08 12:05:00 UTC [RFC 3161]',
    action: 'GEL_CONSERVATOIRE_48H',
    acteur: 'AGT-AN-042',
    roleNiveau: 2,
    details: 'Blocage de 1 450 000 000 FCFA sur compte COBAC, dossier "BGF-089"',
    hachagePrecedent: '1111111111111111111111111111111111111111111111111111111111111111',
    hachageActuel: '2222222222222222222222222222222222222222222222222222222222222222',
    estValide: true
  }
];

const mockAssertion: WebAuthnAssertionResult = {
  success: true,
  credentialId: 'cred-touchid-441-anif',
  biometricMethod: 'TOUCH_ID',
  rawChallengeHex: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  signatureHex: '3045022100e4b2c1f93018283940192a83b4c5d6e7f80918273645e4f3a2b1c0d9e8f7',
  timestampRFC3161: '2026-11-08 15:45:00 UTC [RFC 3161]',
  rpId: 'localhost'
};

test('escapeCsvField properly escapes strings with quotes, commas, and newlines', () => {
  assert.strictEqual(escapeCsvField('simple'), '"simple"');
  assert.strictEqual(escapeCsvField('quote "test" here'), '"quote ""test"" here"');
  assert.strictEqual(escapeCsvField('field,with,commas'), '"field,with,commas"');
  assert.strictEqual(escapeCsvField('multi\nline'), '"multi\nline"');
  assert.strictEqual(escapeCsvField(42), '"42"');
  assert.strictEqual(escapeCsvField(null), '""');
});

test('computeCumulativeMerkleRoot returns 64-character SHA-256 hex string deterministically', async () => {
  const root1 = await computeCumulativeMerkleRoot(mockLogs);
  const root2 = await computeCumulativeMerkleRoot(mockLogs);
  assert.strictEqual(root1.length, 64);
  assert.strictEqual(root1, root2);

  const emptyRoot = await computeCumulativeMerkleRoot([]);
  assert.strictEqual(emptyRoot.length, 64);
  assert.notStrictEqual(root1, emptyRoot);
});

test('generateSignedAuditCsv includes Merkle leaf hashes, WebAuthn signature, and headers', async () => {
  const { csvContent, filename, merkleRootSeal, documentSignature } = await generateSignedAuditCsv({
    auditLogs: mockLogs,
    currentUser: mockUser,
    assertion: mockAssertion,
    exportReason: 'Ordonnance judiciaire régalienne'
  });

  assert.ok(filename.includes('ANIF_WORM_AUDIT_SIGNE_AGT-AN-042'));
  assert.ok(filename.endsWith('.csv'));
  assert.strictEqual(merkleRootSeal.length, 64);
  assert.strictEqual(documentSignature.length, 64);

  // Check headers
  assert.ok(csvContent.includes('# SIGNATAIRE_MATRICULE: AGT-AN-042'));
  assert.ok(csvContent.includes('# METHODE_AUTHENTIFICATION_FORTE: TOUCH_ID'));
  assert.ok(csvContent.includes('# SCEAU_RACINE_MERKLE_WORM: ' + merkleRootSeal));
  assert.ok(csvContent.includes('# SIGNATURE_NUMERIQUE_DOCUMENT_SHA256: ' + documentSignature));

  // Check columns
  assert.ok(csvContent.includes('Index,ID_Entree,Horodatage_RFC3161,Action,Matricule_Agent,Niveau_Habilitation,Details_Evenement,Hachage_Precedent,Hachage_Feuille_Merkle,Integrite_Validee'));

  // Check data rows contain the Merkle leaf hashes
  assert.ok(csvContent.includes('"1111111111111111111111111111111111111111111111111111111111111111"'));
  assert.ok(csvContent.includes('"2222222222222222222222222222222222222222222222222222222222222222"'));
  assert.ok(csvContent.includes('GEL_CONSERVATOIRE_48H'));
});

test('verifySignedAuditCsv validates continuous Merkle chain and flags tampered chains', async () => {
  const { csvContent } = await generateSignedAuditCsv({
    auditLogs: mockLogs,
    currentUser: mockUser,
    assertion: mockAssertion
  });

  const verified = verifySignedAuditCsv(csvContent);
  assert.strictEqual(verified.isValid, true);
  assert.strictEqual(verified.totalEntries, 2);
  assert.strictEqual(verified.signerMatricule, 'AGT-AN-042');
  assert.strictEqual(verified.biometricMethod, 'TOUCH_ID');
  assert.strictEqual(verified.errors.length, 0);

  // Tamper with the CSV: alter the previous hash of the second row to break chain
  const brokenCsv = csvContent.replace(
    '"1111111111111111111111111111111111111111111111111111111111111111","2222222222222222222222222222222222222222222222222222222222222222"',
    '"FORGED_HASH_ALTERED_99999999999999999999999999999999999999999999999999999999","2222222222222222222222222222222222222222222222222222222222222222"'
  );

  const tamperedCheck = verifySignedAuditCsv(brokenCsv);
  assert.strictEqual(tamperedCheck.isValid, false);
  assert.ok(tamperedCheck.errors.some((e) => e.includes('Rupture de chaîne Merkle')));
});
