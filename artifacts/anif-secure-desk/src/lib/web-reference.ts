/**
 * Web references are attached by the API (POST /api/itsm/tickets/{id}/web-reference)
 * as an ordinary ticket update whose body follows a fixed layout. These helpers
 * read that layout back so the history can show the reference as a card.
 */

export const WEB_REFERENCE_MARKER = 'Référence web ajoutée';
export const WEB_REFERENCE_NOTE_MAX = 500;
export const WEB_REFERENCE_URL_MAX = 2048;
const EXCERPT_HEADER = 'Extrait récupéré automatiquement (contenu externe, non vérifié) :';

export type WebReference = {
  title: string;
  url: string;
  note: string | null;
  excerpt: string;
};

export function parseWebReferenceUpdate(body: string): WebReference | null {
  if (!body.startsWith(`${WEB_REFERENCE_MARKER} : `)) return null;
  const lines = body.split('\n');
  const title = lines[0]!.slice(WEB_REFERENCE_MARKER.length + 3).trim();
  const sourceLine = lines[1] ?? '';
  if (!sourceLine.startsWith('Source : ')) return null;
  const url = sourceLine.slice('Source : '.length).trim();
  // Only render links the API could have produced: https, never javascript: or data:.
  if (!/^https:\/\/[^\s]+$/u.test(url)) return null;
  let index = 2;
  let note: string | null = null;
  if (lines[index]?.startsWith('Note : ')) {
    note = lines[index]!.slice('Note : '.length).trim() || null;
    index += 1;
  }
  const headerIndex = lines.indexOf(EXCERPT_HEADER, index);
  const excerpt = headerIndex === -1 ? '' : lines.slice(headerIndex + 1).join('\n').trim();
  return { title: title || url, url, note, excerpt };
}

/** Display form of a URL: host and path, without the scheme. */
export function shortUrl(url: string): string {
  return url.replace(/^https:\/\//u, '').replace(/\/$/u, '');
}

/**
 * Mirrors the API rule (manageTicket): N3, and N4 on tickets of its services.
 * N4 only ever receives the tickets of its own services, so a visible ticket qualifies.
 */
export function canAddWebReference(roleCode: string, ticket: { status: string }): boolean {
  if (roleCode !== 'N3' && roleCode !== 'N4') return false;
  return ticket.status !== 'Clos' && ticket.status !== 'Rejeté';
}

/** Quick client-side check; the API applies the full rules (IP, internal names, ports). */
export function webReferenceUrlProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return 'Indiquez l’adresse de la page.';
  if (url.length > WEB_REFERENCE_URL_MAX) return 'Adresse trop longue (2 048 caractères maximum).';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Adresse invalide. Exemple : https://support.editeur.example/kb/42';
  }
  if (parsed.protocol !== 'https:') return 'Seules les pages publiques en https sont acceptées.';
  return null;
}

/** Turns an API refusal into the message shown under the form. */
export function webReferenceErrorMessage(error: unknown): string {
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data: unknown }).data : null;
  const reason = data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
    ? (data as { error: string }).error
    : null;
  if (reason) return reason;
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : null;
  if (status === 504) return 'Le service de récupération de pages n’a pas répondu à temps. Réessayez plus tard.';
  return 'La référence n’a pas pu être ajoutée. Vérifiez votre connexion puis réessayez.';
}
