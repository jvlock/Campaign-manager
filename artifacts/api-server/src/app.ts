import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import organizationRouter from "./routes/organization";
import { organizationAuthentication, type Authenticate } from "./middlewares/organization-authorization";
import { logger } from "./lib/logger";
import { assertPlanningDatabaseIsolation, planningAccessMode } from "@workspace/db";
import planningRouter from "./routes/index";
import developmentRouter from "./routes/development";
import { developmentPolicy } from "./lib/development-policy";
import { bootstrapKnownSyntheticFixture } from "./lib/webinar-foundation";

export function createApp(options: { authenticate?: Authenticate; mode?: "restricted" | "open-development" } = {}): Express {
  const mode = options.mode ?? "restricted";
  if (mode !== "restricted" && mode !== "open-development") throw new Error("Invalid planning access mode");
  if (mode === "open-development" && planningAccessMode !== mode) throw new Error("Open development requires validated server configuration");
  const app: Express = express();

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
  app.use(cors());
  const webinarPath = /^\/api\/(?:campaigns\/[^/]+\/webinars\/[^/]+\/(?:standard(?:\/|$)|date-impact-preview\/?$)|development\/foundation\/observations(?:\/refresh)?\/?$)/;
  const sessionPatchPath = /^\/api\/campaigns\/[^/]+\/webinars\/[^/]+\/?$/;
  const boundedWebinarRequest = (req: express.Request) =>
    webinarPath.test(req.path) || (req.method === "PATCH" && sessionPatchPath.test(req.path));
  // This parser must run before the general parser: oversized webinar payloads must
  // never be allocated and parsed under Express's larger default limit.
  app.use((req, res, next) => {
    if (mode !== "open-development" || !boundedWebinarRequest(req)) { next(); return; }
    express.json({ limit: "16kb", strict: true })(req, res, error => {
      if (error) { next(error); return; }
      express.urlencoded({ limit: "16kb", extended: false })(req, res, next);
    });
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (mode === "open-development" && boundedWebinarRequest(req)) {
      const tooLarge = (error as { type?: string }).type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({ error: { code: "VALIDATION_ERROR",
        message: tooLarge ? "Request exceeds webinar API payload limit" : "Invalid webinar API request body" } });
      return;
    }
    next(error);
  });

  app.use("/api", healthRouter);
  app.get("/api/development/status", async (_req, res) => {
    if (mode === "open-development") {
      try { await assertPlanningDatabaseIsolation(); bootstrapKnownSyntheticFixture(); }
      catch {
        res.status(503).json({ mode, planningAccess: false, unverified: true, operationalActionsEnabled: false,
          error: { code: "development_isolation_required", message: "Isolated synthetic planning database verification failed." } });
        return;
      }
    }
    res.json({ mode, planningAccess: mode === "open-development", unverified: true, operationalActionsEnabled: false });
  });
  if (mode === "open-development") {
    app.use("/api", async (_req, res, next) => {
      try { await assertPlanningDatabaseIsolation(); bootstrapKnownSyntheticFixture(); next(); }
      catch { res.status(503).json({ error: { code: "development_isolation_required", message: "Isolated synthetic planning database verification failed." } }); }
    }, developmentPolicy, developmentRouter, planningRouter);
    return app;
  }
  app.use("/api", organizationAuthentication(options.authenticate), organizationRouter);

  return app;
}

export default createApp();
