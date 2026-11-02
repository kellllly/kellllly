import { migrate } from './seed';
import type { Store } from './types';

export const STORAGE_KEY = 'anif-demo-v1';
export type StorageIssue = { kind: 'load' | 'save'; message: string } | null;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * An unreadable existing save must NEVER be replaced by seed data automatically.
 * Only an explicitly confirmed reset can leave the memory-only recovery mode.
 */
export function readDemoStore(getStorage: () => StorageAccess = () => localStorage): {
  store: Store; issue: StorageIssue; writeBlocked: boolean;
} {
  let storage: StorageAccess;
  let raw: string | null;
  try {
    storage = getStorage();
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      store: migrate(null), writeBlocked: true,
      issue: { kind: 'load', message: 'Le stockage local est indisponible. Mode mémoire uniquement : les modifications seront perdues au rechargement.' },
    };
  }
  if (raw === null) return { store: migrate(null), issue: null, writeBlocked: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Format inattendu');
    for (const field of ['tickets', 'conversations', 'audit', 'services', 'assets', 'kedb']) {
      if (field in parsed && !Array.isArray(parsed[field])) throw new Error('Collection invalide');
    }
    const store = migrate(parsed);
    for (const ticket of store.tickets) {
      if (!Number.isFinite(Date.parse(ticket.openedAt))) throw new Error('Date invalide');
      for (const at of [ticket.acknowledgedAt, ticket.resolvedAt, ticket.closedAt]) {
        if (at && (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(ticket.openedAt))) {
          throw new Error('Chronologie invalide');
        }
      }
    }
    for (const conversation of store.conversations) {
      if (typeof conversation.title !== 'string' || !Array.isArray(conversation.participants)
        || conversation.messages.some(m => typeof m.body !== 'string' || typeof m.author !== 'string')) {
        throw new Error('Conversation invalide');
      }
    }
    return { store, issue: null, writeBlocked: false };
  } catch {
    let backedUp = false;
    try {
      const key = `${STORAGE_KEY}-illisible`;
      if (storage.getItem(key) === null) storage.setItem(key, raw);
      backedUp = storage.getItem(key) === raw;
    } catch { /* The original key remains untouched even when backup fails. */ }
    return {
      store: migrate(null), writeBlocked: true,
      issue: {
        kind: 'load',
        message: `Les données existantes sont illisibles et leur clé d’origine a été conservée sans modification.${backedUp ? ' Une copie de secours est également conservée.' : ''} Le démonstrateur fonctionne uniquement en mémoire. Une réinitialisation confirmée dans les Préférences est nécessaire pour les remplacer et reprendre l’enregistrement.`,
      },
    };
  }
}

export function writeDemoStore(
  store: Store,
  getStorage: () => StorageAccess = () => localStorage,
): StorageIssue {
  try {
    getStorage().setItem(STORAGE_KEY, JSON.stringify(store));
    return null;
  } catch (error) {
    const quota = error instanceof DOMException
      && (error.name === 'QuotaExceededError' || error.code === 22);
    return {
      kind: 'save',
      message: quota
        ? 'Espace de stockage local saturé : les dernières modifications ne sont pas enregistrées. Exportez le journal puis réinitialisez la démonstration depuis les Préférences.'
        : 'Échec de l’enregistrement local : les dernières modifications ne sont pas conservées après rechargement.',
    };
  }
}
