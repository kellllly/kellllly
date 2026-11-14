/**
 * Règles du navigateur qui protègent les données, vérifiées au plus près :
 * ces tests ont été écrits à partir des mutants que Stryker laissait vivre
 * (stryker.config.json). Chaque valeur attendue est écrite en dur, ou comparée
 * à l'API qui applique la même règle côté serveur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { findSensitiveData } from '../src/lib/sensitive-data.ts';
import { formatCheckpoint, parseCheckpoint, verifyMerkleInclusion } from '../src/lib/audit-merkle.ts';
import { MESSAGE_TTL_OPTIONS, isExpiredMessage, remainingLabel } from '../src/lib/ephemeral.ts';
import { TEMPORARY_DURATIONS } from '../src/lib/temporary-channel.ts';
import { isStepUpHint, reverificationHintOf, stepUpMessage, withStepUpHint } from '../src/lib/step-up.ts';
import { roleRequestError } from '../src/lib/role-administration.ts';
import { directPeer } from '../src/lib/protected-channel.ts';
import { merkleInclusionProof, merkleRoot } from '../../api-server/src/lib/itsm-audit-merkle.ts';

// --- Données nominatives -------------------------------------------------------

const found = (...texts: string[]) => findSensitiveData(...texts).map(({ kind, sample }) => `${kind}=${sample}`);

test('each finding is masked to its first and last two characters', () => {
  assert.deepEqual(found('Contacter awa.mba@example.ga demain'), ['Adresse e-mail=aw…ga'], 'le début réel de l’adresse');
  assert.deepEqual(found('Virement GA21 4002 1001 0000 0000 0000 001 reçu'), ['IBAN=GA…01'], 'l’IBAN entier, pas un fragment');
  assert.deepEqual(found('Mme née  le 3 mai'), ['Mention d’identité (né le, passeport, CNI…)=né…le'], 'plusieurs espaces');
  assert.deepEqual(found('Vu sa CNI'), ['Mention d’identité (né le, passeport, CNI…)=••••'], 'une valeur de 4 caractères ou moins est masquée entièrement');
});

test('card numbers need a valid Luhn check digit and 13 to 19 digits', () => {
  const card = (digits: string) => found(`Carte ${digits} bloquée`).filter((f) => f.startsWith('Numéro de carte bancaire'));
  assert.equal(card('5555 5555 5555 4444').length, 1, 'chiffres doublés supérieurs à 9');
  assert.equal(card('5555 5555 5555 4445').length, 0, 'clé de contrôle fausse');
  assert.equal(card('4222222222222').length, 1, '13 chiffres');
  assert.equal(card('422222222222').length, 0, '12 chiffres');
  assert.equal(card('4000000000000000006').length, 1, '19 chiffres');
  assert.equal(card('40000000000000000006').length, 0, '20 chiffres');
});

test('a passage is reported once: no phone number inside an IBAN, no duplicate across texts', () => {
  assert.deepEqual(found('IBAN GA21 4002 1001 0000 0000 0000 001'), ['IBAN=GA…01']);
  assert.deepEqual(found('awa@example.ga et awa@example.ga', 'encore awa@example.ga'), ['Adresse e-mail=aw…ga']);
  assert.deepEqual(found('a@example.ga', 'b@example.ga').length, 2);
});

// --- Preuve Merkle vérifiée dans le navigateur -----------------------------------

const seals = (n: number) => Array.from({ length: n }, (_, i) => createHash('sha256').update(`e${i}`).digest('hex'));

test('every server proof verifies, and only with the exact proof length', async () => {
  for (const size of [1, 2, 3, 5, 8, 13]) {
    const list = seals(size);
    const root = merkleRoot(list);
    for (let index = 0; index < size; index += 1) {
      const proof = merkleInclusionProof(list, index);
      assert.equal(await verifyMerkleInclusion(list[index]!, index, size, proof, root), true, `${size}/${index}`);
      assert.equal(await verifyMerkleInclusion(list[index]!, index, size, [...proof, list[0]!], root), false, 'preuve trop longue');
      if (proof.length) assert.equal(await verifyMerkleInclusion(list[index]!, index, size, proof.slice(0, -1), root), false, 'preuve trop courte');
    }
  }
});

test('malformed inputs are refused before any computation', async () => {
  const list = seals(4);
  const root = merkleRoot(list);
  const proof = merkleInclusionProof(list, 1);
  const ok = (seal = list[1]!, index = 1, size = 4, p: string[] = proof, r = root) => verifyMerkleInclusion(seal, index, size, p, r);
  assert.equal(await ok(), true);
  assert.equal(await ok(list[1]!.toUpperCase()), false, 'sceau en majuscules');
  assert.equal(await ok(`0${list[1]}`), false, 'sceau de 65 caractères');
  assert.equal(await ok(list[1]!.slice(1)), false, 'sceau de 63 caractères');
  assert.equal(await ok(undefined, undefined, undefined, undefined, `${root}0`), false, 'racine trop longue');
  assert.equal(await ok(undefined, 4), false, 'position égale à la taille');
  assert.equal(await ok(undefined, -1), false);
  assert.equal(await ok(undefined, 1.5), false);
  assert.equal(await ok(undefined, undefined, 4.5), false);
  assert.equal(await ok(undefined, undefined, undefined, [proof[0]!, 'zz']), false, 'élément de preuve invalide');
  assert.equal(await ok(undefined, undefined, undefined, [...proof.slice(0, -1), proof.at(-1)!.toUpperCase()]), false);
  const single = seals(1);
  assert.equal(await verifyMerkleInclusion(single[0]!, 0, 1, [], merkleRoot(single)), true, 'arbre d’un seul événement');
  assert.equal(await verifyMerkleInclusion(single[0]!, 0, 1, [single[0]!], merkleRoot(single)), false);
});

test('a checkpoint is read back only when complete and well formed', () => {
  const root = 'ab'.repeat(32);
  assert.deepEqual(parseCheckpoint(formatCheckpoint({ size: 7, root })), { size: 7, root });
  assert.deepEqual(parseCheckpoint(`  12 : ${root.toUpperCase()}  `), { size: 12, root }, 'espaces et casse ignorés');
  assert.equal(parseCheckpoint(`1:${root}`)?.size, 1, 'un arbre d’un événement');
  assert.equal(parseCheckpoint(`0:${root}`), null, 'taille nulle');
  assert.equal(parseCheckpoint(`x7:${root}`), null, 'texte avant la taille');
  assert.equal(parseCheckpoint(`7:${root}ff`), null, 'texte après la racine');
  assert.equal(parseCheckpoint(`1234567890:${root}`), null, 'taille de plus de 9 chiffres');
});

// --- Messages éphémères et canaux temporaires -------------------------------------

const API_TTL = { min: 30, max: 30 * 24 * 60 * 60 }; // MIN/MAX_MESSAGE_TTL_SECONDS (api-server/src/lib/itsm-workspace.ts)
const API_HOURS = { min: 1, max: 30 * 24 }; // MIN/MAX_TEMPORARY_HOURS

test('the lifetimes and durations offered are exactly those the API accepts', () => {
  assert.deepEqual(MESSAGE_TTL_OPTIONS, [
    { seconds: 0, label: 'Permanent' },
    { seconds: 30, label: '30 secondes' },
    { seconds: 300, label: '5 minutes' },
    { seconds: 3600, label: '1 heure' },
    { seconds: 86_400, label: '24 heures' },
    { seconds: 604_800, label: '7 jours' },
    { seconds: 2_592_000, label: '30 jours' },
  ]);
  for (const { seconds } of MESSAGE_TTL_OPTIONS.filter((o) => o.seconds)) assert.ok(seconds >= API_TTL.min && seconds <= API_TTL.max, String(seconds));
  assert.deepEqual(TEMPORARY_DURATIONS, [
    { hours: 1, label: '1 heure' },
    { hours: 24, label: '24 heures' },
    { hours: 72, label: '3 jours' },
    { hours: 168, label: '7 jours' },
    { hours: 720, label: '30 jours' },
  ]);
  for (const { hours } of TEMPORARY_DURATIONS) assert.ok(hours >= API_HOURS.min && hours <= API_HOURS.max, String(hours));
});

test('an ephemeral message expires at its exact expiry time, and the countdown changes unit at each boundary', () => {
  const now = Date.parse('2026-11-08T10:00:00.000Z');
  const msg = (expiresAt?: string, expired?: boolean) => ({ id: 'm', author: 'a', body: 'x', time: '', ...(expiresAt ? { expiresAt } : {}), ...(expired ? { expired } : {}) });
  const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();
  assert.equal(isExpiredMessage(msg(at(0)), now), true, 'à l’instant exact');
  assert.equal(isExpiredMessage(msg('pas une date'), now), false);
  assert.equal(remainingLabel(msg(at(0)), now), null);
  assert.equal(remainingLabel(msg(at(-5)), now), null);
  assert.equal(remainingLabel(msg(at(120), true), now), null, 'effacé par le serveur même avant l’échéance');
  assert.equal(remainingLabel(msg('pas une date'), now), null);
  assert.equal(remainingLabel(msg(at(59)), now), '59 s');
  assert.equal(remainingLabel(msg(at(60)), now), '1 min 00 s');
  assert.equal(remainingLabel(msg(at(3599)), now), '59 min 59 s');
  assert.equal(remainingLabel(msg(at(3600)), now), '1 h 00');
  assert.equal(remainingLabel(msg(at(86_399)), now), '23 h 59');
  assert.equal(remainingLabel(msg(at(86_400)), now), '1 j 0 h');
  assert.equal(remainingLabel(msg(at(0.2)), now), '1 s', 'arrondi au-dessus');
});

// --- Réauthentification et administration des rôles ------------------------------------

test('only a well-formed Clerk refusal becomes a reverification hint', async () => {
  const hint = { clerk_error: { type: 'forbidden', reason: 'reverification-error' } };
  for (const odd of [null, undefined, 'texte', 403, { data: null }, { data: 'texte' }, { data: {} }, { data: { clerk_error: { type: 'forbidden', reason: 'autre' } } }, { data: { clerk_error: { type: 'autre', reason: 'reverification-error' } } }]) {
    assert.equal(reverificationHintOf(odd), null, JSON.stringify(odd));
  }
  assert.deepEqual(reverificationHintOf({ data: hint }), hint);
  for (const odd of [null, 0, 'clerk_error', { other: 1 }]) assert.equal(isStepUpHint(odd), false, String(odd));
  assert.equal(isStepUpHint(hint), true);
  await assert.rejects(withStepUpHint(async () => { throw 'texte'; })(), (error) => error === 'texte');
  for (const odd of [null, 'reverification_cancelled', { code: 'autre' }, { data: { code: 'autre' } }, { data: 'second_factor_required' }]) {
    assert.equal(stepUpMessage(odd), null, JSON.stringify(odd));
  }
  assert.equal(stepUpMessage({ data: { code: 'second_factor_required' } }), 'Cette action exige une double authentification.');
});

test('role errors are specific to the operation that failed', () => {
  const http = (status: number, message = '', data?: unknown) => Object.assign(new Error(message), { status, ...(data === undefined ? {} : { data }) });
  assert.equal(roleRequestError(http(401, 'Unauthorized'), 'attestation'), 'Unauthorized', 'le message de session expirée est propre à l’attribution');
  assert.equal(roleRequestError(http(400, 'Les services autorisés sont introuvables'), 'attestation'), 'Les services autorisés sont introuvables');
  assert.match(roleRequestError(http(400, 'Un ou plusieurs services autorisés sont introuvables dans le pilote.'), 'assignment'), /n’est plus présent dans le pilote/u, 'message exact de l’API (routes/itsm.ts)');
  assert.equal(roleRequestError(http(400, 'Requête invalide'), 'assignment'), 'Requête invalide', 'un autre refus 400 garde son motif');
  assert.equal(roleRequestError(http(403, 'Forbidden', { error: '  Dernier N1 actif.  ' }), 'assignment'), 'Dernier N1 actif. Le rôle n’a pas été modifié.', 'motif du serveur sans espaces');
  assert.match(roleRequestError(http(403, 'Forbidden', { error: '   ' }), 'assignment'), /Cette modification a été refusée/u);
  assert.match(roleRequestError(http(403, 'Forbidden', { error: 42 }), 'assignment'), /Cette modification a été refusée/u);
  assert.match(roleRequestError(http(403, 'Forbidden', 'texte'), 'assignment'), /Cette modification a été refusée/u);
  assert.equal(roleRequestError(http(403, 'Forbidden', { error: 'Refus' }), 'attestation'), 'Forbidden');
  assert.equal(roleRequestError(http(503, 'Service Unavailable'), 'assignment'), 'Service Unavailable', 'l’indisponibilité du répertoire est propre au répertoire');
  assert.match(roleRequestError(http(503, ''), 'directory'), /temporairement indisponible/u);
  assert.equal(roleRequestError(Object.assign(new Error('x'), { status: '500' }), 'directory'), 'x', 'un statut non numérique n’est pas un refus HTTP');
  assert.match(roleRequestError({ name: 'AbortError' }, 'assignment'), /résultat de l’opération est incertain/u);
  assert.equal(roleRequestError({ name: 'Autre' }, 'assignment'), 'Le service des habilitations n’a pas pu terminer cette opération.');
  assert.equal(roleRequestError(null, 'archive'), 'Le service des habilitations n’a pas pu terminer cette opération.');
});

test('a bilateral channel falls back to its participants only when it has no member list', () => {
  assert.equal(directPeer({ kind: 'Direct', memberIds: [], participants: ['user_me', 'user_peer'] }, 'user_me'), 'user_peer');
  assert.equal(directPeer({ kind: 'Direct', participants: ['user_me', 'user_peer'] } as never, 'user_me'), 'user_peer');
});

// --- Résumé de diagnostic relu depuis sessionStorage (donnée non fiable) -------------

import {
  DIAGNOSTIC_HANDOFF_KEY, DIAGNOSTIC_HANDOFF_TTL_MS, consumeDiagnosticTicketHandoff, diagnosticSymptomLabel,
  diagnosticTicketPrefill, findDiagnosticKedbSuggestions, isDiagnosticSymptomId, saveDiagnosticTicketHandoff, ticketCategoryForService,
} from '../src/lib/diagnostic-assistant.ts';

class Memory {
  items = new Map<string, string>();
  removed: string[] = [];
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.removed.push(key); this.items.delete(key); }
}
const valid = { serviceId: 'SVC-02', symptomId: 'performance', impact: 1, urgency: 3, apiProbe: 'unavailable' } as const;
const t0 = Date.parse('2026-11-10T10:00:00.000Z');

test('the hand-off lives in one fixed key for ten minutes, read once', () => {
  assert.equal(DIAGNOSTIC_HANDOFF_KEY, 'anif-diagnostic-ticket-handoff-v1');
  assert.equal(DIAGNOSTIC_HANDOFF_TTL_MS, 600_000);
  const memory = new Memory();
  assert.equal(saveDiagnosticTicketHandoff(memory, valid, t0), true);
  assert.deepEqual(JSON.parse(memory.getItem(DIAGNOSTIC_HANDOFF_KEY)!), { version: 1, createdAt: t0, ...valid });
  assert.deepEqual(consumeDiagnosticTicketHandoff(memory, t0 + 600_000), valid, 'accepté à 10 min pile');
  assert.deepEqual(memory.removed, [DIAGNOSTIC_HANDOFF_KEY]);
  assert.equal(consumeDiagnosticTicketHandoff(memory, t0), null, 'déjà consommé');
  assert.deepEqual(memory.removed, [DIAGNOSTIC_HANDOFF_KEY], 'rien à retirer la seconde fois');
  saveDiagnosticTicketHandoff(memory, valid, t0);
  assert.equal(consumeDiagnosticTicketHandoff(memory, t0 + 600_001), null, 'au-delà de 10 min');
  saveDiagnosticTicketHandoff(memory, valid, t0);
  assert.deepEqual(consumeDiagnosticTicketHandoff(memory, t0), valid, 'âge nul');
  assert.equal(saveDiagnosticTicketHandoff(memory, valid, Number.NaN), false);
  saveDiagnosticTicketHandoff(memory, valid, t0);
  assert.equal(consumeDiagnosticTicketHandoff(memory, Number.NaN), null);
});

test('a tampered or malformed hand-off is discarded field by field, and storage failures never throw', () => {
  const read = (raw: string) => { const memory = new Memory(); memory.setItem(DIAGNOSTIC_HANDOFF_KEY, raw); return consumeDiagnosticTicketHandoff(memory, t0); };
  const record = (patch: Record<string, unknown>) => JSON.stringify({ version: 1, createdAt: t0, ...valid, ...patch });
  assert.deepEqual(read(record({})), valid);
  for (const [field, value] of [
    ['version', 2], ['createdAt', 'hier'], ['serviceId', 'SVC 02'], ['serviceId', 'x'.repeat(81)], ['serviceId', 42], ['serviceId', ''],
    ['symptomId', 'inconnu'], ['symptomId', 1], ['impact', 4], ['impact', '1'], ['urgency', 0], ['apiProbe', 'ok'],
  ] as const) assert.equal(read(record({ [field]: value })), null, `${field}=${JSON.stringify(value)}`);
  assert.deepEqual(read(record({ serviceId: 'a.b_c-D9' })), { ...valid, serviceId: 'a.b_c-D9' });
  assert.deepEqual(read(record({ serviceId: 'x'.repeat(80) }))?.serviceId.length, 80);
  for (const raw of ['', 'null', '[]', '"texte"', '42', '{', JSON.stringify([record({})])]) assert.equal(read(raw), null, raw);
  assert.deepEqual(read(record({ extra: 'ignoré', serviceId: 'SVC-02' })), valid, 'seuls les champs attendus sont repris');

  const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('plein'); }, removeItem: () => {} };
  assert.equal(consumeDiagnosticTicketHandoff(broken, t0), null);
  assert.equal(saveDiagnosticTicketHandoff(broken, valid, t0), false);
  for (const bad of [null, [], { ...valid, impact: 9 }, { ...valid, apiProbe: 'x' }]) assert.equal(saveDiagnosticTicketHandoff(new Memory(), bad as never, t0), false, JSON.stringify(bad));
});

test('the ticket prefill states exactly what was checked, for each API result', () => {
  const service = { id: 'SVC-02', name: 'Portail de services', category: 'Applications', status: 'Vigilance', owner: 'x', sla: 'y', description: 'z' };
  const prefill = diagnosticTicketPrefill(valid, service as never);
  assert.deepEqual({ ...prefill, description: undefined }, {
    kind: 'Incident', title: 'Incident — Portail de services : Service lent ou instable', category: 'Applications',
    impact: 1, urgency: 3, supportLevel: 1, serviceId: 'SVC-02', description: undefined,
  });
  assert.equal(prefill.description, [
    'Signalement issu du parcours guidé de démonstration.',
    'Service : Portail de services (SVC-02).',
    'Symptôme sélectionné : Service lent ou instable.',
    'Impact et urgence déclarés : 1 / 3.',
    'API du pilote injoignable au moment du contrôle.',
    'État affiché dans le catalogue du pilote : Vigilance.',
    'Aucune sonde vers Nkok ou Keycloak n’est configurée; aucun contrôle de ces systèmes n’a été effectué.',
  ].join('\n'));
  assert.match(diagnosticTicketPrefill({ ...valid, apiProbe: 'healthy' }, service as never).description, /\nAPI du pilote accessible au moment du contrôle\.\n/u);
  assert.match(diagnosticTicketPrefill({ ...valid, apiProbe: 'not-run' }, service as never).description, /\nAPI du pilote non contrôlée\.\n/u);
  assert.equal(diagnosticSymptomLabel('other'), 'Autre symptôme technique');
  assert.equal(diagnosticSymptomLabel('inconnu' as never), 'Autre symptôme technique');
  assert.equal(isDiagnosticSymptomId('access'), true);
  assert.equal(isDiagnosticSymptomId('toString'), false);
  assert.equal(ticketCategoryForService('  RÉSEAU  '), 'Réseau');
});

test('KEDB suggestions: service first, then category and symptom words, newest first on ties', () => {
  const service = { id: 'SVC-03', name: 'Réseau', category: 'Infrastructure', status: 'Opérationnel', owner: 'x', sla: 'y', description: 'z' } as never;
  const article = (id: string, patch: Record<string, unknown>) => ({ id, title: 't', symptom: 's', rootCause: 'r', resolution: 'x', ticketId: 'T', category: 'Divers', createdAt: '2026-11-01T00:00:00Z', author: 'a', reviewStatus: 'published', ...patch });
  const list = [
    article('A', { serviceId: 'SVC-03' }),
    article('B', { category: 'INFRASTRUCTURE' }),
    article('C', { symptom: 'Wifi indisponible, connexion perdue' }),
    article('D', { title: 'Réseau lent', createdAt: '2026-11-05T00:00:00Z' }),
    article('E', { title: 'Réseau lent', createdAt: '2026-11-05T00:00:00Z' }),
    article('F', { title: 'Sans rapport' }),
  ];
  assert.deepEqual(findDiagnosticKedbSuggestions(list, service, 'connectivity', 10).map((a) => a.id), ['A', 'B', 'C', 'D', 'E'], 'score 8, 3, 3 mots, puis 1 mot à égalité triée par id');
  assert.deepEqual(findDiagnosticKedbSuggestions(list, service, 'connectivity').map((a) => a.id), ['A', 'B', 'C'], 'trois par défaut');
  assert.deepEqual(findDiagnosticKedbSuggestions(list, service, 'connectivity', 1).map((a) => a.id), ['A']);
  assert.deepEqual(findDiagnosticKedbSuggestions([article('G', { title: 'réseau', createdAt: '2026-11-02T00:00:00Z' }), article('H', { title: 'réseau', createdAt: '2026-11-09T00:00:00Z' })], service, 'connectivity').map((a) => a.id), ['H', 'G'], 'le plus récent d’abord');
  for (const limit of [0, -1, 1.5, Number.NaN]) assert.deepEqual(findDiagnosticKedbSuggestions(list, service, 'connectivity', limit), [], String(limit));
  assert.deepEqual(findDiagnosticKedbSuggestions(list, undefined, 'connectivity'), []);
  assert.deepEqual(findDiagnosticKedbSuggestions(list, service, 'inconnu' as never), []);
  assert.deepEqual(findDiagnosticKedbSuggestions([article('F', {})], service, 'other'), [], 'aucun score, aucune suggestion');
});
