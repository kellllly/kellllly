/**
 * Simulated attachments: same rules as the API (artifacts/api-server/src/lib/itsm-attachments.ts),
 * keep both lists in step. Only the description of the file leaves the browser
 * (name, type, size, SHA-256); its content is never sent nor stored.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'hta', 'jar', 'lnk', 'dll', 'sys', 'cpl', 'sh', 'apk', 'app', 'iso', 'img', 'reg',
]);
export const USUAL_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
]);
const MACRO_EXTENSIONS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab']);
const ACTIVE_CONTENT_EXTENSIONS = new Set(['html', 'htm', 'svg', 'xml', 'eml', 'msg', 'rtf', 'mht']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff']);
const EXPECTED_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ['application/pdf'],
  png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], gif: ['image/gif'], webp: ['image/webp'],
  txt: ['text/plain'], csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};

export type AttachmentCheck = { blocked: string | null; warnings: string[] };

const extensionsOf = (name: string) => name.toLowerCase().split('.').slice(1).map((part) => part.trim()).filter(Boolean);

/** Reasons to refuse or to warn, from the name and declared type only. */
export function checkAttachment(name: string, type: string, size: number): AttachmentCheck {
  const extensions = extensionsOf(name);
  const extension = extensions.at(-1) ?? '';
  if (extensions.some((part) => BLOCKED_EXTENSIONS.has(part))) {
    return { blocked: `Fichier exécutable ou script (.${extensions.find((part) => BLOCKED_EXTENSIONS.has(part))}) : envoi interdit.`, warnings: [] };
  }
  if (size > MAX_ATTACHMENT_BYTES) return { blocked: 'Fichier de plus de 25 Mo : envoi interdit dans le pilote.', warnings: [] };
  const warnings: string[] = [];
  if (!extension) warnings.push('Fichier sans extension : son format ne peut pas être reconnu.');
  if (extensions.length > 1 && USUAL_EXTENSIONS.has(extensions.at(-2) ?? '')) {
    warnings.push(`Double extension (${extensions.slice(-2).map((part) => `.${part}`).join('')}) : procédé courant pour déguiser un fichier.`);
  }
  if (MACRO_EXTENSIONS.has(extension)) warnings.push('Document Office avec macros : il peut exécuter du code à l’ouverture.');
  else if (ARCHIVE_EXTENSIONS.has(extension)) warnings.push('Archive compressée : son contenu n’est pas contrôlé avant l’ouverture.');
  else if (ACTIVE_CONTENT_EXTENSIONS.has(extension)) warnings.push('Format pouvant contenir des liens, scripts ou contenus distants.');
  else if (extension && !USUAL_EXTENSIONS.has(extension)) warnings.push(`Format inhabituel (.${extension}) pour les échanges de l’agence.`);
  const expected = EXPECTED_TYPES[extension];
  if (expected && type && !expected.includes(type.toLowerCase())) {
    warnings.push(`Le type déclaré (${type}) ne correspond pas à l’extension .${extension}.`);
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    warnings.push('Photo ou image : le pilote ne purge pas les métadonnées (EXIF, géolocalisation).');
  }
  if (size === 0) warnings.push('Fichier vide.');
  return { blocked: null, warnings };
}

export type AttachmentDescription = { name: string; type: string; size: number; sha256: string };

export async function describeFile(file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>): Promise<AttachmentDescription> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { name: file.name, type: file.type, size: file.size, sha256 };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} Ko`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} Mo`;
}
