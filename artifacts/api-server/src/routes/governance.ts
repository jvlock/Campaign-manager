import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  GovernanceError,
  commitImportBatch,
  createApproval,
  createComment,
  createImportBatch,
  createTerm,
  getImportBatch,
  listApprovals,
  listComments,
  listGovernanceAudit,
  listTerms,
  resolveTerm,
  reviewImportCandidate,
  updateApproval,
  updateComment,
  updateTerm,
} from "../lib/governance";
import {
  GovernanceQuarantineError,
  PROVISIONAL_GOVERNANCE,
} from "../lib/governance-quarantine";

const router: IRouter = Router();

function errorResponse(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof GovernanceQuarantineError) {
    res.status(error.status).json({
      error: error.message,
      details: { field: error.field, code: error.code, governance: PROVISIONAL_GOVERNANCE },
    });
    return;
  }
  if (error instanceof GovernanceError) {
    res.status(error.status).json({ error: error.message, details: error.details ?? undefined });
    return;
  }
  next(error);
}

function provisionalImportReview<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(provisionalImportReview) as T;
  const record = value as Record<string, unknown>;
  const output = Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    provisionalImportReview(entry),
  ])) as Record<string, unknown>;
  if (record.status === "approved") {
    output.status = "business_review_complete";
    output.governanceApproved = false;
    output.governance = PROVISIONAL_GOVERNANCE;
  } else if (
    record.status === "staged"
    && typeof record.reviewNote === "string"
    && record.reviewNote.startsWith("BUSINESS_REVIEW_COMPLETE")
  ) {
    output.status = "business_review_complete";
    output.governanceApproved = false;
    output.governance = PROVISIONAL_GOVERNANCE;
  }
  return output as T;
}

function body(req: Request) {
  return (req.body ?? {}) as Record<string, unknown>;
}

router.get("/governance/audit", async (req, res, next) => {
  try {
    const result = await listGovernanceAudit(req.query);
    const nextOffset = result.total > result.page.offset + result.page.limit ? result.page.offset + result.page.limit : null;
    res.setHeader("X-Pagination", JSON.stringify({ total: result.total, returned: result.items.length, nextOffset, hasMore: nextOffset !== null }));
    res.json(result.items);
  } catch (error) {
    if ((error as { status?: number }).status === 400) { res.status(400).json({ error: (error as Error).message }); return; }
    errorResponse(error, res, next);
  }
});

router.get("/governance/terms", async (req, res, next) => {
  try {
    res.json(await listTerms(req.query));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

// Keep resolve ahead of /:id so clients can use either GET or POST without the
// literal "resolve" being interpreted as a UUID term id.
router.post("/governance/terms/resolve", async (req, res, next) => {
  try {
    res.json(await resolveTerm(body(req) as { versionId?: unknown; version?: unknown; code: unknown }));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.get("/governance/terms/resolve", async (req, res, next) => {
  try {
    res.json(await resolveTerm(req.query as { versionId?: unknown; version?: unknown; code: unknown }));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/terms", async (req, res, next) => {
  try {
    res.status(201).json(await createTerm(body(req) as Parameters<typeof createTerm>[0]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.patch("/governance/terms/:id", async (req, res, next) => {
  try {
    res.json(await updateTerm(req.params.id, body(req) as Parameters<typeof updateTerm>[1]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/terms/:id/deprecate", async (req, res, next) => {
  try {
    res.json(await updateTerm(req.params.id, { ...body(req), action: "deprecate" } as Parameters<typeof updateTerm>[1]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/terms/:id/rename", async (req, res, next) => {
  try {
    res.json(await updateTerm(req.params.id, { ...body(req), action: "rename" } as Parameters<typeof updateTerm>[1]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/imports", async (req, res, next) => {
  try {
    const input = body(req);
    if (input.candidates === undefined && input.rows !== undefined) input.candidates = input.rows;
    res.status(201).json(await createImportBatch(input as Parameters<typeof createImportBatch>[0]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.get("/governance/imports/:batchId", async (req, res, next) => {
  try {
    res.json(provisionalImportReview(await getImportBatch(req.params.batchId)));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.patch("/governance/imports/:batchId/candidates/:candidateId", async (req, res, next) => {
  try {
    res.json(provisionalImportReview(await reviewImportCandidate(
      req.params.batchId,
      req.params.candidateId,
      body(req) as Parameters<typeof reviewImportCandidate>[2],
    )));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/imports/:batchId/commit", async (req, res, next) => {
  try {
    res.json(provisionalImportReview(await commitImportBatch(req.params.batchId, body(req) as Parameters<typeof commitImportBatch>[1])));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.get("/governance/approvals", async (req, res, next) => {
  try {
    res.json(await listApprovals(req.query));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/approvals", async (req, res, next) => {
  try {
    res.status(201).json(await createApproval(body(req) as Parameters<typeof createApproval>[0]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.patch("/governance/approvals/:id", async (req, res, next) => {
  try {
    res.json(await updateApproval(req.params.id, body(req) as Parameters<typeof updateApproval>[1]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.get("/governance/comments", async (req, res, next) => {
  try {
    res.json(await listComments(req.query as { recordType: unknown; recordId: unknown }));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/comments", async (req, res, next) => {
  try {
    res.status(201).json(await createComment(body(req) as Parameters<typeof createComment>[0]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.patch("/governance/comments/:id", async (req, res, next) => {
  try {
    res.json(await updateComment(req.params.id, body(req) as Parameters<typeof updateComment>[1]));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

export default router;