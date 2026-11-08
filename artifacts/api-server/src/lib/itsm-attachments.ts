/**
 * Simulated attachments (cahier des charges, traitement des fichiers): the
 * pilot has no file storage, so only the description of the file is kept
 * (name, type, size, SHA-256 computed in the browser), never its content.
 * Executables and scripts are refused; unusual or risky formats require the
 * sender to confirm the pedagogical warning shown before sending. The same
 * lists are used by the browser (artifacts/anif-secure-desk/src/lib/attachments.ts).
 */

type JsonRecord = Record<string, unknown>;

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "hta", "jar", "lnk", "dll", "sys", "cpl", "sh", "apk", "app", "iso", "img", "reg",
]);
export const USUAL_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "docx", "xlsx", "pptx", "odt", "ods", "odp",
]);
const MACRO_EXTENSIONS = new Set(["docm", "xlsm", "pptm", "dotm", "xltm"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "cab"]);
const ACTIVE_CONTENT_EXTENSIONS = new Set(["html", "htm", "svg", "xml", "eml", "msg", "rtf", "mht"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff"]);
const EXPECTED_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], gif: ["image/gif"], webp: ["image/webp"],
  txt: ["text/plain"], csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
};

export type AttachmentCheck = { blocked: string | null; warnings: string[] };

const extensionsOf = (name: string) => name.toLowerCase().split(".").slice(1).map((part) => part.trim()).filter(Boolean);

/** Reasons to refuse or to warn, from the name and declared type only. */
export function checkAttachment(name: string, type: string, size: number): AttachmentCheck {
  const extensions = extensionsOf(name);
  const extension = extensions.at(-1) ?? "";
  if (extensions.some((part) => BLOCKED_EXTENSIONS.has(part))) {
    return { blocked: `Fichier exécutable ou script (.${extensions.find((part) => BLOCKED_EXTENSIONS.has(part))}) : envoi interdit.`, warnings: [] };
  }
  if (size > MAX_ATTACHMENT_BYTES) return { blocked: "Fichier de plus de 25 Mo : envoi interdit dans le pilote.", warnings: [] };
  const warnings: string[] = [];
  if (!extension) warnings.push("Fichier sans extension : son format ne peut pas être reconnu.");
  if (extensions.length > 1 && USUAL_EXTENSIONS.has(extensions.at(-2) ?? "")) {
    warnings.push(`Double extension (${extensions.slice(-2).map((part) => `.${part}`).join("")}) : procédé courant pour déguiser un fichier.`);
  }
  if (MACRO_EXTENSIONS.has(extension)) warnings.push("Document Office avec macros : il peut exécuter du code à l’ouverture.");
  else if (ARCHIVE_EXTENSIONS.has(extension)) warnings.push("Archive compressée : son contenu n’est pas contrôlé avant l’ouverture.");
  else if (ACTIVE_CONTENT_EXTENSIONS.has(extension)) warnings.push("Format pouvant contenir des liens, scripts ou contenus distants.");
  else if (extension && !USUAL_EXTENSIONS.has(extension)) warnings.push(`Format inhabituel (.${extension}) pour les échanges de l’agence.`);
  const expected = EXPECTED_TYPES[extension];
  if (expected && type && !expected.includes(type.toLowerCase())) {
    warnings.push(`Le type déclaré (${type}) ne correspond pas à l’extension .${extension}.`);
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    warnings.push("Photo ou image : le pilote ne purge pas les métadonnées (EXIF, géolocalisation).");
  }
  if (size === 0) warnings.push("Fichier vide.");
  return { blocked: null, warnings };
}

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Validates the attachment of a new message. Returns undefined when there is
 * none; throws when it is malformed, refused, or carries an unconfirmed warning.
 * The warnings stored are recomputed here, never taken from the client.
 */
export function sanitizeAttachment(raw: unknown): JsonRecord | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) throw new Error("Pièce jointe invalide.");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const type = typeof raw.type === "string" ? raw.type.trim().slice(0, 120) : "";
  const size = Number(raw.size);
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : "";
  if (!name || name.length > 160 || /[\\/\u0000-\u001f]/u.test(name)) throw new Error("Nom de pièce jointe invalide.");
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Taille de pièce jointe invalide.");
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error("Empreinte de pièce jointe invalide.");
  const check = checkAttachment(name, type, size);
  if (check.blocked) throw new Error(check.blocked);
  if (check.warnings.length && raw.acknowledged !== true) {
    throw new Error("Pièce jointe inhabituelle : l’avertissement doit être confirmé avant l’envoi.");
  }
  return { name, type, size, sha256, warnings: check.warnings, ...(check.warnings.length ? { acknowledged: true } : {}) };
}
