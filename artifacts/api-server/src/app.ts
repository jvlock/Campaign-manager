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
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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
