import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import organizationRouter from "./routes/organization";
import { organizationAuthentication, type Authenticate } from "./middlewares/organization-authorization";
import { logger } from "./lib/logger";

export function createApp(options: { authenticate?: Authenticate } = {}): Express {
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
  app.use("/api", organizationAuthentication(options.authenticate), organizationRouter);

  return app;
}

export default createApp();
