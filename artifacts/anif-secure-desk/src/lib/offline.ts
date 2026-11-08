/**
 * Offline-first support (cahier des charges, exigences non fonctionnelles):
 * when the network drops, edits stay in the browser and are sent, in order,
 * once the link is back. The pending state is kept in this browser's local
 * storage (not encrypted in this pilot) as a recovery draft with a fixed id,
 * so a reload or a closed tab does not lose it.
 */

export const OFFLINE_DRAFT_ID = 'hors-ligne';
export const OFFLINE_RETRY_MS = 10_000;

/** Gateway statuses a proxy returns when the API cannot be reached. */
const UNREACHABLE_STATUSES = new Set([502, 504]);

/**
 * True when a save failed because the API could not be reached, as opposed to
 * a refusal by the API (validation, permission, version conflict).
 */
export function isNetworkFailure(error: unknown, online: boolean): boolean {
  if (!online) return true;
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return UNREACHABLE_STATUSES.has(status);
  const name = (error as { name?: unknown }).name;
  const message = String((error as { message?: unknown }).message ?? '');
  return name === 'TypeError' && /fetch|network|load failed/i.test(message);
}

export function offlineMessage(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  const duration = minutes < 1 ? 'moins d’une minute' : `${minutes} min`;
  return `Hors ligne depuis ${duration}. Vos saisies restent dans ce navigateur et seront envoyées automatiquement, dans l’ordre, au retour du réseau. Ne fermez pas la session sur un poste partagé.`;
}
