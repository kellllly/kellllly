import { createHmac } from "node:crypto";

export const DEVELOPMENT_ROLE_ARCHIVE_PATH = "/api/itsm/development-role-archive";

type Environment = Record<string, string | undefined>;

export function developmentRoleArchiveEnabled(env: Environment = process.env): boolean {
  return env.NODE_ENV === "development" && env.ITSM_DEV_ROLE_ARCHIVE_ENABLED === "true";
}

/**
 * Explicit development setup only. Domain separation avoids sending the session
 * secret itself to the receiver. Production keeps the external archive settings.
 */
export function developmentRoleArchiveConfig(env: Environment = process.env) {
  if (!developmentRoleArchiveEnabled(env)) throw new Error("Archive de développement désactivée.");
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET requis pour l’archive de développement.");
  const configuredUrl = env.ITSM_DEV_ROLE_ARCHIVE_URL;
  if (configuredUrl === "auto" && !env.REPLIT_DEV_DOMAIN) {
    throw new Error("Domaine de développement indisponible pour l’archive.");
  }
  const endpoint = new URL(configuredUrl === "auto"
    ? `https://${env.REPLIT_DEV_DOMAIN}${DEVELOPMENT_ROLE_ARCHIVE_PATH}`
    : configuredUrl ?? "");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password
    || endpoint.pathname !== DEVELOPMENT_ROLE_ARCHIVE_PATH || endpoint.search || endpoint.hash) {
    throw new Error("Adresse HTTPS invalide pour l’archive de développement.");
  }
  const token = createHmac("sha256", env.SESSION_SECRET)
    .update("anif:development-role-archive:v1")
    .digest("hex");
  return { endpoint, headers: { Authorization: `Bearer ${token}` } };
}
