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

const router: IRouter = Router();

function errorResponse(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof GovernanceError) {
    res.status(error.status).json({ error: error.message, details: error.details ?? undefined });
    return;
  }
  next(error);
}

function body(req: Request) {
  return (req.body ?? {}) as Record<string, unknown>;
}

router.get("/governance/audit", async (req, res, next) => {
  try {
    res.json(await listGovernanceAudit(req.query));
  } catch (error) {
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
    res.json(await getImportBatch(req.params.batchId));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.patch("/governance/imports/:batchId/candidates/:candidateId", async (req, res, next) => {
  try {
    res.json(await reviewImportCandidate(
      req.params.batchId,
      req.params.candidateId,
      body(req) as Parameters<typeof reviewImportCandidate>[2],
    ));
  } catch (error) {
    errorResponse(error, res, next);
  }
});

router.post("/governance/imports/:batchId/commit", async (req, res, next) => {
  try {
    res.json(await commitImportBatch(req.params.batchId, body(req) as Parameters<typeof commitImportBatch>[1]));
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