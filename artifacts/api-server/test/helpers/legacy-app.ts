/**
 * Isolated legacy-router regression harness, NOT a production authorization bypass.
 * These tests preserve pre-foundation behavior; organization.routes.test.ts exercises
 * the actual fail-closed application and its authoritative organization services.
 */
import express from "express";
import pinoHttp from "pino-http";
import router from "../../src/routes";
import { logger } from "../../src/lib/logger";

const app = express();
// Legacy handlers use req.log when reporting validation errors. Match the
// production request logger rather than changing their validation behavior.
app.use(pinoHttp({ logger }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", router);
export default app;