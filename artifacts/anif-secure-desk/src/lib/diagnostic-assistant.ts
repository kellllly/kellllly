import type { KedbArticle, Level, Service } from './types';

export const DIAGNOSTIC_HANDOFF_KEY = 'anif-diagnostic-ticket-handoff-v1';
export const DIAGNOSTIC_HANDOFF_TTL_MS = 10 * 60 * 1000;

export const DIAGNOSTIC_SYMPTOMS = [
  {
    id: 'connectivity',
    label: 'Connexion ou réseau indisponible',
    category: 'Réseau',
    terms: ['connexion', 'réseau', 'wifi', 'indisponible'],
  },
  {
    id: 'access',
    label: 'Accès ou authentification refusé',
    category: 'Accès',
    terms: ['accès', 'authentification', 'compte', 'session'],
  },
  {
    id: 'performance',
    label: 'Service lent ou instable',
    category: 'Applications',
    terms: ['lent', 'lenteur', 'instable', 'performance', 'délai'],
  },
  {
    id: 'application',
    label: 'Erreur dans une application',
    category: 'Applications',
    terms: ['application', 'erreur', 'portail', 'fonctionnement'],
  },
  {
    id: 'other',
    label: 'Autre symptôme technique',
    category: 'Applications',
    terms: [],
  },
] as const;

export type DiagnosticSymptomId = (typeof DIAGNOSTIC_SYMPTOMS)[number]['id'];
export type DiagnosticApiProbe = 'healthy' | 'unavailable' | 'not-run';

export type DiagnosticTicketHandoff = {
  serviceId: string;
  symptomId: DiagnosticSymptomId;
  impact: Level;
  urgency: Level;
  apiProbe: DiagnosticApiProbe;
};

export type DiagnosticStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const symptomById = new Map<string, (typeof DIAGNOSTIC_SYMPTOMS)[number]>(
  DIAGNOSTIC_SYMPTOMS.map((symptom) => [symptom.id, symptom]),
);

export function isDiagnosticSymptomId(value: unknown): value is DiagnosticSymptomId {
  return typeof value === 'string' && symptomById.has(value);
}

export function diagnosticSymptomLabel(id: DiagnosticSymptomId): string {
  return symptomById.get(id)?.label ?? 'Autre symptôme technique';
}

export function ticketCategoryForService(category: string): string {
  const normalized = category.trim().toLocaleLowerCase('fr-FR');
  if (/réseau|infrastructure|connectivité/u.test(normalized)) return 'Réseau';
  if (/accès|identité|authentification|sécurité/u.test(normalized)) return 'Accès';
  if (/poste de travail/u.test(normalized)) return 'Poste de travail';
  if (/équipement|matériel/u.test(normalized)) return 'Équipement';
  return 'Applications';
}

export function findDiagnosticKedbSuggestions(
  articles: readonly KedbArticle[],
  service: Service | undefined,
  symptomId: DiagnosticSymptomId,
  limit = 3,
): KedbArticle[] {
  if (!service || !Number.isInteger(limit) || limit < 1) return [];
  const symptom = symptomById.get(symptomId);
  if (!symptom) return [];

  return articles
    .map((article) => {
      const searchable = [
        article.title,
        article.symptom,
        article.rootCause,
        article.resolution,
        article.category,
      ].join(' ').toLocaleLowerCase('fr-FR');
      const serviceMatch = article.serviceId === service.id;
      const categoryMatch = article.category.toLocaleLowerCase('fr-FR')
        === service.category.toLocaleLowerCase('fr-FR');
      const termMatches = symptom.terms.filter((term) => searchable.includes(term)).length;
      const score = (serviceMatch ? 8 : 0) + (categoryMatch ? 3 : 0) + termMatches;
      return { article, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score
      || b.article.createdAt.localeCompare(a.article.createdAt)
      || a.article.id.localeCompare(b.article.id))
    .slice(0, limit)
    .map(({ article }) => article);
}

function isLevel(value: unknown): value is Level {
  return value === 1 || value === 2 || value === 3;
}

function isDiagnosticApiProbe(value: unknown): value is DiagnosticApiProbe {
  return value === 'healthy' || value === 'unavailable' || value === 'not-run';
}

function isValidServiceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(value);
}

function isValidHandoff(value: unknown): value is DiagnosticTicketHandoff {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return isValidServiceId(draft.serviceId)
    && isDiagnosticSymptomId(draft.symptomId)
    && isLevel(draft.impact)
    && isLevel(draft.urgency)
    && isDiagnosticApiProbe(draft.apiProbe);
}

export function saveDiagnosticTicketHandoff(
  storage: DiagnosticStorage,
  handoff: DiagnosticTicketHandoff,
  now = Date.now(),
): boolean {
  if (!isValidHandoff(handoff) || !Number.isFinite(now)) return false;
  try {
    storage.setItem(DIAGNOSTIC_HANDOFF_KEY, JSON.stringify({
      version: 1,
      createdAt: now,
      ...handoff,
    }));
    return true;
  } catch {
    return false;
  }
}

export function consumeDiagnosticTicketHandoff(
  storage: DiagnosticStorage,
  now = Date.now(),
): DiagnosticTicketHandoff | null {
  let raw: string | null;
  try {
    raw = storage.getItem(DIAGNOSTIC_HANDOFF_KEY);
    if (raw !== null) storage.removeItem(DIAGNOSTIC_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw || !Number.isFinite(now)) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !Number.isFinite(record.createdAt)) return null;
    const age = now - Number(record.createdAt);
    if (age < 0 || age > DIAGNOSTIC_HANDOFF_TTL_MS) return null;
    return isValidHandoff(record) ? {
      serviceId: record.serviceId,
      symptomId: record.symptomId,
      impact: record.impact,
      urgency: record.urgency,
      apiProbe: record.apiProbe,
    } : null;
  } catch {
    return null;
  }
}

export function diagnosticTicketPrefill(
  handoff: DiagnosticTicketHandoff,
  service: Service,
) {
  const apiResult = handoff.apiProbe === 'healthy'
    ? 'API du pilote accessible au moment du contrôle'
    : handoff.apiProbe === 'unavailable'
      ? 'API du pilote injoignable au moment du contrôle'
      : 'API du pilote non contrôlée';
  return {
    kind: 'Incident' as const,
    title: `Incident — ${service.name} : ${diagnosticSymptomLabel(handoff.symptomId)}`,
    category: ticketCategoryForService(service.category),
    impact: handoff.impact,
    urgency: handoff.urgency,
    supportLevel: 1 as const,
    serviceId: service.id,
    description: [
      'Signalement issu du parcours guidé de démonstration.',
      `Service : ${service.name} (${service.id}).`,
      `Symptôme sélectionné : ${diagnosticSymptomLabel(handoff.symptomId)}.`,
      `Impact et urgence déclarés : ${handoff.impact} / ${handoff.urgency}.`,
      `${apiResult}.`,
      `État affiché dans le catalogue du pilote : ${service.status}.`,
      'Aucune sonde vers Nkok ou Keycloak n’est configurée; aucun contrôle de ces systèmes n’a été effectué.',
    ].join('\n'),
  };
}

const SUGGESTION_STOP_WORDS = new Set(['pour', 'dans', 'avec', 'sans', 'plus', 'depuis', 'apres', 'avant', 'sous', 'vers', 'chez', 'entre', 'cette', 'votre', 'notre', 'leur', 'sont', 'fait', 'impossible', 'probleme']);
// shortcut: a 6-letter prefix stands in for French stemming ("certificats" ≈ "certificat"); switch to a real stemmer if suggestions get noisy.
const suggestionStems = (text: string) => new Set(text.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{M}/gu, '')
  .split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !SUGGESTION_STOP_WORDS.has(w)).map(w => w.slice(0, 6)));

/** Known errors close to a ticket being written: the title must share a word with the article. */
export function findKedbSuggestionsForDraft(
  articles: readonly KedbArticle[],
  draft: { title: string; category: string; serviceId: string },
  limit = 3,
): KedbArticle[] {
  const terms = suggestionStems(draft.title);
  if (!terms.size) return [];
  return articles
    .map((article) => {
      const text = suggestionStems([article.title, article.symptom, article.rootCause, article.resolution].join(' '));
      const hits = [...terms].filter(t => text.has(t)).length;
      const score = hits * 2 + (draft.serviceId && article.serviceId === draft.serviceId ? 3 : 0) + (article.category === draft.category ? 1 : 0);
      return { article, hits, score };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.score - a.score || b.article.createdAt.localeCompare(a.article.createdAt))
    .slice(0, limit)
    .map(({ article }) => article);
}
