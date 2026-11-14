import type { KedbArticle } from './types';

/**
 * Guided diagnosis of the support channel (cahier des charges : agent
 * conversationnel « Bot SI »). A fixed decision tree, not an AI: each topic
 * maps to a ticket category, a few self-service steps and KEDB keywords.
 */
export type AssistantTopic = {
  id: string;
  label: string;
  category: string;
  steps: string[];
  keywords: string[];
};

export const ASSISTANT_TOPICS: readonly AssistantTopic[] = [
  {
    id: 'network', label: 'Réseau ou accès au serveur', category: 'Réseau',
    steps: ['Vérifier le câble ou le Wi-Fi institutionnel.', 'Rouvrir l’application après 30 secondes.', 'Tester un autre poste du même bureau.'],
    keywords: ['réseau', 'connexion', 'vpn', 'wi-fi', 'lien', 'serveur'],
  },
  {
    id: 'account', label: 'Compte, mot de passe ou authentification', category: 'Accès',
    steps: ['Vérifier la clé de sécurité ou l’application d’authentification.', 'Se déconnecter puis se reconnecter.', 'Ne jamais communiquer son code à un tiers, même au support.'],
    keywords: ['compte', 'mot de passe', 'authentification', 'accès', 'clé', 'session'],
  },
  {
    id: 'printer', label: 'Imprimante ou périphérique', category: 'Équipement',
    steps: ['Vérifier l’alimentation et le papier.', 'Annuler les travaux bloqués dans la file.', 'Choisir une autre imprimante sécurisée de l’étage.'],
    keywords: ['imprimante', 'impression', 'scanner', 'périphérique', 'écran'],
  },
  {
    id: 'workstation', label: 'Poste de travail lent ou bloqué', category: 'Poste de travail',
    steps: ['Fermer les applications inutilisées.', 'Redémarrer le poste.', 'Vérifier l’espace disque disponible.'],
    keywords: ['poste', 'lent', 'lenteur', 'bloqué', 'ordinateur', 'démarrage'],
  },
  {
    id: 'application', label: 'Application ou messagerie', category: 'Applications',
    steps: ['Recharger la page.', 'Vérifier la version affichée de l’application.', 'Noter le message d’erreur exact, sans données personnelles.'],
    keywords: ['application', 'messagerie', 'erreur', 'pièce jointe', 'affichage', 'synchronisation'],
  },
];

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Self-service KEDB articles for a topic: same category first, then keyword matches. */
export function suggestArticles(topic: AssistantTopic, articles: readonly KedbArticle[], limit = 3): KedbArticle[] {
  const words = topic.keywords.map(normalize);
  const score = (article: KedbArticle) => {
    const text = normalize(`${article.title} ${article.symptom} ${article.resolution}`);
    return (article.category === topic.category ? 2 : 0) + words.filter((word) => text.includes(word)).length;
  };
  return articles.filter((article) => article.reviewStatus === 'published').map((article) => ({ article, value: score(article) }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map(({ article }) => article);
}

export type IntegrityCheck = { label: string; ok: boolean; detail: string };

/** Report placed in the message box when the person still needs help. */
export function assistantReport(topic: AssistantTopic, checks: readonly IntegrityCheck[]): string {
  return [
    `[Assistant SI] ${topic.label} (catégorie ${topic.category}).`,
    `Étapes de libre-service essayées : ${topic.steps.length}.`,
    `Tests préliminaires : ${checks.map((check) => `${check.label} ${check.ok ? 'OK' : 'ÉCHEC'} (${check.detail})`).join(' ; ') || 'non lancés'}.`,
    'Symptôme : ',
  ].join('\n');
}
