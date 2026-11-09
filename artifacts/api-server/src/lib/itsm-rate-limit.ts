import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

/**
 * Per-account request quota for the expensive journal routes (integrity,
 * Merkle proof, SIEM feed, CSV export): each call reads the whole journal and
 * recomputes the chain, so an authenticated account looping on them could
 * saturate the server. Mounted after authentication, keyed by the Clerk user
 * id (the client IP only when no account is known).
 */
export function createAuditRateLimit({
  accountOf,
  limit = 30,
  windowMs = 60_000,
}: {
  accountOf: (req: Request) => string | null | undefined;
  limit?: number;
  windowMs?: number;
}): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const account = accountOf(req);
      return account ? `account:${account}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
    },
    handler: (req, res, _next, options) => {
      req.log?.warn({ alert: "itsm_audit_rate_limited" }, "ITSM audit route rate limit reached");
      res.status(options.statusCode).json({
        error: "Trop de demandes sur le journal en peu de temps. Patientez une minute avant de réessayer.",
      });
    },
  });
}
