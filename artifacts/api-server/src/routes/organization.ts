import { Router } from "express";
import { createOrganizationService } from "../lib/organization/service";
import { OrganizationAccessError, type VerifiedPrincipal } from "../lib/organization/policy";
import { PROVISIONAL_GOVERNANCE } from "../lib/governance-quarantine";

const router = Router();
const service = createOrganizationService();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately not the legacy detail serializer: child ownership and attachments
// require independent decisions and are not part of this bounded read surface.
async function campaignSummary(principal: VerifiedPrincipal, id: string) {
  return service.withAuthorized(principal, "read", { type: "campaign", id }, async (client) => {
    const result = await client.query(
      `SELECT id, name, scope, region, audience, outcome, lifecycle, readiness,
              timing, owner, row_version AS "rowVersion", updated_at AS "updatedAt"
         FROM campaigns WHERE id = $1`, [id],
    );
    const row = result.rows[0];
    return row ? { ...row, parentId: null, governance: PROVISIONAL_GOVERNANCE } : null;
  });
}

router.get("/organization/campaigns", async (_req, res, next) => {
  try {
    const principal = res.locals.organizationPrincipal as VerifiedPrincipal;
    const ids = await service.visibleIds(principal, "campaign");
    const rows = [];
    for (const id of ids) {
      try {
        const row = await campaignSummary(principal, id);
        if (row) rows.push(row);
      } catch (error) {
        // A revocation between enumeration and projection removes the record.
        if (!(error instanceof OrganizationAccessError)) throw error;
      }
    }
    res.json(rows);
  } catch (error) { next(error); }
});

router.get("/organization/campaigns/:id", async (req, res, next) => {
  try {
    if (!uuid.test(req.params.id)) {
      res.status(404).json({ error: { code: "record_unavailable", message: "Record unavailable." } });
      return;
    }
    const row = await campaignSummary(res.locals.organizationPrincipal, req.params.id);
    if (!row) throw new OrganizationAccessError();
    res.json(row);
  } catch (error) { next(error); }
});

// No fall-through to unscoped legacy reads, search, exports or writes.
router.use((_req, res) => {
  res.status(403).json({ error: { code: "scoped_operation_unavailable", message: "This operation is not enabled by the organizational authorization foundation." } });
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if (error instanceof OrganizationAccessError) {
    res.status(404).json({ error: { code: "record_unavailable", message: "Record unavailable." } });
    return;
  }
  res.status(503).json({ error: { code: "authorization_unavailable", message: "Authoritative authorization is unavailable." } });
});

export default router;