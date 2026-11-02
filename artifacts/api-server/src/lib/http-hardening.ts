import type { CorsOptions } from "cors";
import type { ErrorRequestHandler, RequestHandler } from "express";

type Environment = Record<string, string | undefined>;

/**
 * The browser saves the whole shared workspace on every change, and the audit
 * keeps up to 5000 events (~1 MB). Express's default 100 KB limit would make
 * every save fail with HTTP 413 after a few hundred journal entries.
 */
export const ITSM_JSON_BODY_LIMIT = "5mb";

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Cross-origin access is opt-in. The web app and API share one origin on
 * Replit and behind the local Vite proxy, so no CORS header is needed there.
 */
export function allowedCorsOrigins(env: Environment = process.env): string[] {
  const explicit = (env.CORS_ALLOWED_ORIGINS ?? "").split(",");
  const replit = (env.REPLIT_DOMAINS ?? "").split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)
    .map((domain) => `https://${domain}`);
  const origins = [...explicit, ...replit]
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}

export function corsOptions(env: Environment = process.env): CorsOptions {
  const allowed = new Set(allowedCorsOrigins(env));
  return {
    credentials: true,
    origin: (origin, callback) => {
      callback(null, Boolean(origin && allowed.has(origin)));
    },
  };
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
};

export function isAuthConfigured(env: Environment = process.env): boolean {
  return Boolean(env.CLERK_SECRET_KEY?.trim());
}

export const AUTH_NOT_CONFIGURED_MESSAGE =
  "L’authentification n’est pas configurée sur ce serveur (CLERK_SECRET_KEY manquante).";

/** Replaces Clerk when its secret is absent: a clear 503 instead of a stack trace per request. */
export const authNotConfigured: RequestHandler = (_req, res) => {
  res.status(503).json({ error: AUTH_NOT_CONFIGURED_MESSAGE });
};

type ErrorLogger = { error: (fields: Record<string, unknown>, message: string) => void };

/**
 * Final error handler: logs the failure server-side and never returns stack
 * traces, file paths or library messages to the browser.
 */
export function jsonErrorHandler(logger: ErrorLogger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof error?.status === "number" && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    if (status >= 500) {
      logger.error({ err: error, method: req.method, url: req.originalUrl?.split("?")[0] }, "Unhandled API error");
    }
    res.status(status).json({
      error: status === 413
        ? "Requête trop volumineuse."
        : status >= 500 ? "Erreur interne du serveur." : "Requête invalide.",
    });
  };
}
