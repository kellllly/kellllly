import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  ITSM_JSON_BODY_LIMIT,
  authNotConfigured,
  corsOptions,
  isAuthConfigured,
  jsonErrorHandler,
  securityHeaders,
} from "./lib/http-hardening";
import healthRouter from "./routes/health";
import {
  DEVELOPMENT_ROLE_ARCHIVE_PATH,
  developmentRoleArchiveConfig,
  developmentRoleArchiveEnabled,
} from "./lib/development-role-archive-config";
import { developmentArchiveRepository } from "./lib/development-role-archive-storage";
import { createDevelopmentRoleArchiveRouter } from "./routes/development-role-archive";

const app: Express = express();
app.disable("x-powered-by");
app.use(securityHeaders);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Machine-to-machine development receiver, deliberately outside Clerk's user
// session middleware. Never mounted in production or without explicit opt-in.
if (developmentRoleArchiveEnabled()) {
  const config = developmentRoleArchiveConfig();
  app.use(DEVELOPMENT_ROLE_ARCHIVE_PATH, createDevelopmentRoleArchiveRouter({
    authorization: config.headers.Authorization,
    repository: developmentArchiveRepository,
    onStorageError: () => logger.error({ component: "development_role_archive" }, "Archive storage unavailable"),
  }));
}

app.use(cors(corsOptions()));
app.use(express.json({ limit: ITSM_JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true }));

// Public health check: must answer even when authentication is misconfigured.
app.use("/api", healthRouter);

if (isAuthConfigured()) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
  app.use("/api", router);
} else {
  logger.error({ component: "auth" }, "CLERK_SECRET_KEY is not set; authenticated API routes answer 503");
  app.use("/api", authNotConfigured);
}

app.use(jsonErrorHandler(logger));

export default app;
