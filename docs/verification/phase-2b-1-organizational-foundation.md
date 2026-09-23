# Phase 2B-1 — Bounded organizational foundation verification record

## Baseline and scope

Expected/observed starting branch: `feature/webinar-standard-engine`. Starting HEAD: `8230abf264183af0890142ea40bbfc60ab93bb0d`; direct parent: accepted Phase 2B-0B `b19fb35c06249ad4e3d175d84da77c905fbc4913`. That single subsequent commit adds only `attached_assets/Pasted-This-gives-us-the-checkpoint-we-needed-Based-on-Replit-_1790204703178.txt`, an instruction archive, not implementation. Neither that upload nor the current instruction upload should be included in an implementation commit. The Phase 2B-0 assessment, Phase 2B-0A decisions and Phase 2B-0B assessment remain unchanged. This documentation records bounded progress, **not** full Phase 2B-1 completion or live deployment.

Owner decisions A–F are recorded verbatim in [the new decision record](phase-2b-1-owner-decisions.md); original 0B recommendations are preserved as historical proposals, superseded where different. [Architecture, permission matrix, bootstrap and recovery](../organization-foundation.md) describe intended safe operation and present limitations. Preserve the six accepted roles, Foundation authority, pilot no-send, differentiated retention, 106/106 canonical evaluator IDs, legacy templates, request-local diagnostics and concurrency boundaries.

## Implemented surface to verify against source

| Area | Current bounded code | Limit |
|---|---|---|
| Persistence | `0022_organizational_foundation.sql`, `schema/organization.ts` | Additive associations and cutoff registries; no historical owner backfill, no shared database migration |
| Policy/service | `lib/organization/policy.ts`, `service.ts` | Scoped grants, transaction-serialized checks and audit, ownership mapping, transfer, archive, calendar-summary service; not a live identity verifier or complete old-route retrofit |
| HTTP | `app.ts`, `middlewares/organization-authorization.ts`, `routes/organization.ts` | Health plus safe campaign-only summaries; old unscoped routers unmounted; default app denies non-health 503 without trusted verifier; calendar service has no route |
| Tests | `test/organization/`, `test/organization.routes.test.ts`, `lib/db/test/organization-migration.mjs` | Test-injected identities/legacy test harnesses are not deployed authentication or operational authorization |
| Workspace/API contract | `artifacts/campaign-workspace/src/App.tsx`, `lib/api-spec/openapi.yaml` and generated clients/types | Protected-access notice and documented bounded endpoints; no restored legacy product screens |

The migration preserves legacy payload and snapshots pre-cutoff IDs, but this alone does not demonstrate operational compatibility of the old HTTP flows: those flows are currently **unavailable**. Explicitly distinguish synthetic fixture equality from live legacy route behavior. No production migration, provisioning, connector, live send, publish or external integration is claimed.

## Reconciliation with original Phase 2B-1 plan

The original sequence in [Phase 2B-0 §16](phase-2b-0-integration-assessment.md) remains **1 → 2 → 2A → 3 → 4 → 5 → 6 → 8 → 7 → 9 → 10 → 11 → 12 → 13 → 14**. [Phase 2B-0B §13](phase-2b-0b-group-hierarchy-impact-and-plan.md) supplements it, not replaces it.

| Original work | Status in this bounded increment |
|---|---|
| Increment 1 / `CM-ORG-P01` | Organizational model and A–F decisions recorded; exact webinar version/evidence/result ERD and source contracts still pending. |
| Increment 2 / `CM-ORG-P02` | Only additive organizational 0022 persistence and isolated fixture checks; webinar transitions/evidence/exception/snapshot migrations still pending. |
| Increment 2A / `CM-ORG-P03` | Pure/service-side scoped authorization and restricted campaign read surface only. Trusted live identity binding, full existing-route coverage, authenticated mutations and job/external-boundary authorization still pending. |
| `CM-ORG-P06` | Source-backed service-only webinar occurrence calendar summaries; UI, complete date adapters, totals/exports and financial rollups pending/deferred as approved. |
| Increments 3–14 / `CM-ORG-P04/P05/P07` | Original webinar adapters, orchestration, transitions, attendance, Foundation connector, suppression, APIs, UI, legacy export and full release gates remain pending; cross-cutting legacy and isolation protections apply throughout. |

## Fresh verification and initial failure reconciliation

These are **fresh bounded-increment measurements supplied by the verifying implementer**, not the historical Phase 2B-0B 3,158-leaf/21-migration figures. Commands use the existing project runners:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*/*.test.ts'
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts' './test/organization/service.database.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck --incremental false
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
```

| Suite | Files | Top-level | Nested | TAP records | Grouping | Leaves | Final result |
|---|---:|---:|---:|---:|---:|---:|---|
| Domain | 36 | 3,097 | 7 | 3,104 | 1 | 3,103 | Exit 0 |
| API with disposable DB | 16 | 75 | 0 | 75 | 0 | 75 | Exit 0 |
| Frontend regression | 1 | 2 | 0 | 2 | 0 | 2 | Exit 0 |
| **Total** | **53** | **3,174** | **7** | **3,181** | **1** | **3,180** | **Final runs passed** |

The API count includes **15 root files plus `test/organization/service.database.ts` explicitly**; the latter is not matched by `./test/*.test.ts`. Final failures, skips, cancellations, TODOs, setup failures and teardown failures are each **zero**. The first complete API attempt **did fail five tests**: four organization before-hooks lacked fixture `created_by` and one legacy-router test helper lacked `req.log`, producing a 500. The historical failed attempt is retained at `/tmp/phase2b1/api.log`; corrections supplied the required fixture creator and request logger, without weakening assertions. Focused rerun passed **5/5**; complete API rerun `/tmp/phase2b1/api-final.log` passed **75/75**, exit 0. The unchanged domain, full-workspace typecheck and frontend gate remained valid; **nonincremental API typecheck was repeated after the test fixes and passed**, as did `pnpm run typecheck`.

Existing legacy route regression tests deliberately use `artifacts/api-server/test/helpers/legacy-app.ts`, an **isolated old-router harness** with the same request logger expected by legacy handlers; this is **not** the actual production `createApp()`. `organization.routes.test.ts` checks the real fail-closed app. Passing old-router tests proves preservation of those test paths, **not** that historical HTTP routes are currently available or safely re-enabled. The actual app intentionally leaves them unmounted. Desktop preview showed “Protected access is unavailable,” consistent with the intended 503 without trusted authentication. The API workflow was restarted by the verifying implementer and served clean health; a healthy process does **not** mean live organization access or a live database migration.

## Database, canonical and cleanup gates

The disposable DB run applied **all 22 migrations (`0001`–`0022`)**, both to a fresh database and a representative **synthetic pre-0022** prior-schema fixture. Each mode rejected **16 invalid operations**; comparisons found **44 preexisting table payloads byte-equal** across the additive upgrade, including synthetic legacy-session payloads. This is fixture compatibility evidence only, not a claim that live legacy HTTP flows are enabled or that production data was migrated. Final disposable root `/tmp/disposable-pg-gaoVGO` reported normal cleanup, PostgreSQL stopped, socket removed and root removed; independent absence was confirmed. The initially failed run `/tmp/disposable-pg-3fn0vm` also had confirmed cleanup. **No production or shared-environment migration was applied.**

Rule-ID drift check returned **106 rules, zero drift**. Canonical evaluator registry is **106/106**, `missing=[]`, `unknown=[]`, `duplicate=0`; organizational tests do not inflate that registry. Current hashes match the accepted baseline:

| Unchanged canonical file | SHA-256 |
|---|---|
| `docs/standards/webinar/WEB-STANDARD-001.rules.json` | `7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2` |
| `docs/standards/webinar/WEB-STANDARD-001.md` | `74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25` |
| `docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md` | `87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f` |
| `docs/standards/webinar/CHANGELOG-RC1.md` | `b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c` |
| `docs/standards/webinar/manifest.json` | `8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859` |

The Temporal polyfill manifest pin remains **0.5.1** and the lockfile is unchanged. Comparison against accepted `b19fb35c06249ad4e3d175d84da77c905fbc4913` found no changes to accepted reports, canonical files or original `0001`–`0021` migrations. Existing Foundation authority, release/version identity, retention, legacy-session protections and no-send restrictions are not reopened.

## Changed-file inventory and completion boundary

Inventory of relevant tracked modifications and new files relative to starting `8230abf264183af0890142ea40bbfc60ab93bb0d`, excluding instruction uploads:

| Area | Exact paths |
|---|---|
| API implementation | `artifacts/api-server/src/app.ts`; `artifacts/api-server/src/lib/organization/policy.ts`; `artifacts/api-server/src/lib/organization/service.ts`; `artifacts/api-server/src/middlewares/organization-authorization.ts`; `artifacts/api-server/src/routes/organization.ts` |
| API tests | `artifacts/api-server/test/deliverables.routes.test.ts`; `artifacts/api-server/test/delivery.test.ts`; `artifacts/api-server/test/governance.test.ts`; `artifacts/api-server/test/webinar-standard.routes.test.ts`; `artifacts/api-server/test/webinar.test.ts`; `artifacts/api-server/test/helpers/legacy-app.ts`; `artifacts/api-server/test/organization.routes.test.ts`; `artifacts/api-server/test/organization/policy.test.ts`; `artifacts/api-server/test/organization/service.database.ts` |
| Database | `lib/db/migrations/0022_organizational_foundation.sql`; `lib/db/src/schema/index.ts`; `lib/db/src/schema/organization.ts`; `lib/db/test/disposable-db.mjs`; `lib/db/test/organization-migration.mjs` |
| Workspace/API contract | `artifacts/campaign-workspace/src/App.tsx`; `lib/api-spec/openapi.yaml`; `lib/api-client-react/src/generated/api.schemas.ts`; `lib/api-client-react/src/generated/api.ts`; `lib/api-zod/src/generated/api.ts`; `lib/api-zod/src/generated/types/index.ts`; `lib/api-zod/src/generated/types/authenticationRequiredResponse.ts`; `lib/api-zod/src/generated/types/authenticationUnavailableResponse.ts`; `lib/api-zod/src/generated/types/organizationAccessError.ts`; `lib/api-zod/src/generated/types/organizationAccessErrorError.ts`; `lib/api-zod/src/generated/types/recordUnavailableResponse.ts`; `lib/api-zod/src/generated/types/scopedOperationUnavailableResponse.ts` |
| Documentation | `docs/organization-foundation.md`; `docs/verification/phase-2b-1-owner-decisions.md`; `docs/verification/phase-2b-1-organizational-foundation.md` |

No ending commit SHA is asserted here: the main implementer commits the scoped work after this documentation, with **direct parent `8230abf264183af0890142ea40bbfc60ab93bb0d`** if HEAD remains unchanged, and reports the resulting SHA separately. Exclude the current instruction upload and unrelated files. This increment establishes **bounded code plus isolated verification**, but **live rollout remains blocked**: no external trusted issuer/subject-to-`users.id` verifier or provisioning is connected; a shape-correct `VerifiedPrincipal` supplied to a service is not authentication. Existing unsafe legacy routers remain intentionally disabled, and full affected route/job coverage and original Phase 2B-1 webinar increments remain outstanding. No production deployment, Foundation connector, live send or publish is claimed. Stop after the bounded increment; do not label all Phase 2B-1 complete.