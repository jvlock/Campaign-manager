import type { Request, RequestHandler } from "express";
import type { VerifiedPrincipal } from "../lib/organization/policy";

/** Supplied by trusted server composition, never by request claims or environment identity. */
export type Authenticate = (request: Request) => Promise<VerifiedPrincipal | null>;

export function organizationAuthentication(authenticate?: Authenticate): RequestHandler {
  return async (req, res, next) => {
    if (!authenticate) {
      res.status(503).json({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "Trusted authentication is unavailable; organizational operations are disabled." } });
      return;
    }
    try {
      const principal = await authenticate(req);
      if (!principal || !principal.userId || !principal.issuer || !principal.subject) {
        res.status(401).json({ error: { code: "authentication_required", message: "Verified authentication is required." } });
        return;
      }
      // Copy only verified identity, not client roles/scopes. Never cache authorization.
      res.locals.organizationPrincipal = Object.freeze({
        userId: principal.userId, issuer: principal.issuer, subject: principal.subject,
      });
      next();
    } catch {
      res.status(503).json({ error: { code: "AUTHENTICATION_UNAVAILABLE", message: "Trusted authentication is unavailable; organizational operations are disabled." } });
    }
  };
}