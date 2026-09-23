# Phase 2A-4 completion evidence

## Starting state and scope

- Branch: `feature/webinar-standard-engine`.
- Accepted starting HEAD: `5f7d5b728dfa2194965d8d02c05c03563658f5e9`.
- Starting parent: `4cf95cb47a5ad163c3383e34580b31813ee55e06`.
- HEAD had not moved. Tracked files were clean. The sole untracked item was the newly supplied instruction attachment; it was preserved unchanged and included in the delivery.
- Fresh baseline: 23 files, 431 top-level/individual tests, no nested subtests, all passing.
- Baseline and final drift checks: 106 rule IDs, zero drift.
- Baseline and final non-incremental API-package TypeScript checks passed.
- No canonical documents, existing classifiers, evaluators, readiness modules, routes, API contracts, UI, database schemas, migrations, sending, publishing, or deployment behavior changed.
- New modules are not wired into the runtime. Outputs describe plans and obligations, not passed evaluations or operational permission.

## Implementation

The repository had date-fns and legacy two-pass Intl conversion helpers, but no implementation with explicit compatible disambiguation and adjustment metadata. After reporting the proposed dependency, added API runtime dependency `@js-temporal/polyfill` 0.5.1, with transitive `jsbi` 4.3.2. Reused existing pure catalog validation and safe-data snapshot/freeze utilities.

The generic package installer refused a workspace-root install. Installation then succeeded through a package-scoped pnpm command. No runtime or workflow configuration change resulted.

### Recruitment

Canonical slots:

| Identity | Original local-calendar offset |
|---|---:|
| recruitment_1 | −21 days |
| recruitment_2 | −14 days |
| recruitment_3 | −7 days |
| final_recruitment | −1 day |

| Local days remaining | Result |
|---|---|
| 21+ | All four nominal offsets |
| 14–20 | Omit recruitment_1; recruitment_2 immediate; retain −7/−1 |
| 7–13 | Omit first two; recruitment_3 immediate; retain −1 |
| 2–6 | Omit first two; recruitment_3 immediate; retain −1 only with ≥24 elapsed hours separation |
| 0–1 before start | Omit first three; final_recruitment immediate; compressed-window warning |
| in_progress, completed, cancelled | All four visibly omitted |

Immediate means exactly the caller's calculation instant. Active statuses with calculation at/after start are rejected, rather than inferred to be in progress. Nominal past touches are omitted without backdating. Scheduled instants are unique, chronological and strictly before start. All four touch identities remain visible, including omissions and their reasons.

Calendar offsets preserve event-local wall-clock time. Compatible disambiguation moves nonexistent times forward by the gap and selects the earlier repeated time. Metadata records the requested local time and adjustment, including for subsequently omitted touches. Coverage includes 23/25-hour days and Apia's skipped calendar date. The older runtime's weekend shifting is deliberately not used.

### Audience and business days

- Event operational state and per-participant attendance/registration states stay structurally separate.
- Only eligible, contactable non-registrants receive a calculated recruitment plan.
- Registration suppresses recruitment and creates immediate confirmation/calendar obligations plus remaining future elapsed-hour reminders.
- Past reminder opportunities are explicitly omitted. Historical trigger deadlines remain descriptive, with overdue flags; they are not send-at instants.
- Change notices apply to people registered by the change trigger. Inconsistent cancellation/registration chronology is rejected.
- Participant cancellation confirms cancellation and suppresses later customer paths. Event cancellation suppresses reminders/follow-up; cancelled waitlists close rather than promote.
- Attended, absent and neutral variants have separate identities even when sharing an asset.
- Unknown attendance creates reconciliation first. Only an explicitly approved neutral variant becomes eligible at/after two business days; it never creates attended and absent variants.
- Waitlist confirmation, promotion and closure obligations are explicit.
- Internal/test participants are excluded from customer communications/reporting; optional QA planning is labelled non-customer.
- Inputs and results are immutable plain data; duplicate participants/communication identities and invalid/inconsistent inputs are rejected.
- Obligations explicitly distinguish deadlines, eligibility thresholds and omissions. No output grants sending, readiness or exception authority.

Business days mean Monday–Friday in the webinar's supplied IANA zone, without holidays. Attended deadlines are one business day after actual event end; absent deadlines are one business day after attendance data becomes available. Neutral eligibility is two business days after actual event end. Deadline calculations preserve local clock time and expose disambiguation metadata.

## Fresh final gates

Counts below are calculated from TAP output and test-file inventories, not forced to an expected total.

| Suite | Files | Top-level tests | Nested subtests | Individual tests |
|---|---:|---:|---:|---:|
| Scheduling | 1 | 33 | 0 | 33 |
| Audience state | 3 | 63 | 0 | 63 |
| Business days/time | 4 | 30 | 0 | 30 |
| Planning containment | 1 | 3 | 0 | 3 |
| Classifier | 1 | 42 | 0 | 42 |
| Readiness | 1 | 44 | 0 | 44 |
| Exceptions | 1 | 172 | 0 | 172 |
| Evaluators | 1 | 20 | 0 | 20 |
| Registry | 1 | 9 | 0 | 9 |
| Existing structural | 1 | 8 | 0 | 8 |
| Catalog integrity | 2 | 65 | 0 | 65 |
| Complete API root suite | 14 | 69 | 0 | 69 |
| Frontend | 1 | 2 | 0 | 2 |
| **Total** | **32** | **560** | **0** | **560** |

All command exit codes were zero. Failures, skipped, cancelled, todo, setup failures, teardown failures and type errors: **0 each**.

Rule-ID drift check: **106 IDs, zero drift**. Evaluator registry: **15 implemented / 106 total; 91 still missing**.

An earlier integration run identified nullable test assertions, a DST test fixture on the wrong day, and a containment allowlist omission for a type-only rule-ID import. All were corrected before the final gates. Review also tightened cancellation chronology and preserved DST metadata on omitted nominal touches.

Final logs were written under `/tmp/phase4-final-*.log`, with exit statuses under `/tmp/phase4-final-*.exit`. These are temporary evidence, not guaranteed permanent storage. Baseline logs use `/tmp/phase4-baseline-*.log`.

### Disposable database

The complete API suite used a newly created disposable database. All 21 migrations applied:

```text
0001_delivery.sql
0002_planning.sql
0003_webinar.sql
0004_governance.sql
0005_planning_integrity.sql
0006_webinar_integrity.sql
0007_webinar_standard.sql
0008_clics_taxonomy.sql
0009_webinar_trigger_events.sql
0010_webinar_trigger_event_replay.sql
0011_webinar_template_version.sql
0012_implementation_tasks.sql
0013_utm_taxonomy_categories.sql
0014_governed_activity_model.sql
0015_activity_model_hardening.sql
0016_foundation_production_taxonomy.sql
0017_reusable_deliverables.sql
0018_validate_landing_page_url.sql
0019_quarantine_foundation_governance.sql
0020_deliverable_reference_constraints.sql
0021_stage_one_deliverable_publish.sql
```

Cleanup reported `postgresStopped=true`, `tempRootRemoved=true`, and `socketRemoved=true`. The temporary root's absence was independently checked. No project or production database migration was performed.

The API workflow restarted successfully. The existing workspace preview rendered normally without browser errors. No deployment was attempted.

### Canonical SHA-256 hashes

All five matched both before and after implementation:

```text
WEB-STANDARD-001.rules.json
7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2
WEB-STANDARD-001.md
74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25
WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md
87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f
CHANGELOG-RC1.md
b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c
manifest.json
8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859
```

## Delivery inventory

Modified:

```text
.agents/memory/MEMORY.md
artifacts/api-server/package.json
pnpm-lock.yaml
```

Added:

```text
.agents/memory/pure-planning-boundary.md
artifacts/api-server/src/lib/webinar-standard-audience/index.ts
artifacts/api-server/src/lib/webinar-standard-audience/plan.ts
artifacts/api-server/src/lib/webinar-standard-audience/types.ts
artifacts/api-server/src/lib/webinar-standard-audience/validate.ts
artifacts/api-server/src/lib/webinar-standard-planning-time/business-days.ts
artifacts/api-server/src/lib/webinar-standard-planning-time/index.ts
artifacts/api-server/src/lib/webinar-standard-planning-time/time.ts
artifacts/api-server/src/lib/webinar-standard-scheduling/index.ts
artifacts/api-server/src/lib/webinar-standard-scheduling/plan.ts
artifacts/api-server/src/lib/webinar-standard-scheduling/types.ts
artifacts/api-server/test/audience-state/audience-state.test.ts
artifacts/api-server/test/audience-state/follow-up.test.ts
artifacts/api-server/test/audience-state/validation-and-properties.test.ts
artifacts/api-server/test/business-days/business-days.test.ts
artifacts/api-server/test/business-days/machine-timezone.test.ts
artifacts/api-server/test/business-days/time-dst.test.ts
artifacts/api-server/test/business-days/validation-immutability.test.ts
artifacts/api-server/test/planning-containment/containment.test.ts
artifacts/api-server/test/scheduling/recruitment-plan.test.ts
attached_assets/Pasted-Phase-2A-3-is-now-accepted-The-evidence-is-internally-c_1790124000415.txt
docs/verification/phase-2a-4.md
```

This report is included in the delivery commit. The completion response records its exact commit hash. No history rewrite or intervening platform-generated commit was observed during implementation. Owner acceptance of the delivered phase remains separate from successful verification.

## Phase 2A-4B repository-hygiene follow-up

### History and artifact disposition

The original inventory above is historical and remains unchanged. The listed
Phase 2A-4 instruction attachment was inadvertently committed; it was removed
from the working tree in the Phase 2A-4B follow-up. Its complete original
contents remain recoverable from commit
`a1614a90bbd5f411117cbc2af0b058bedc4bccdd`. It is not an authoritative
requirements source, and its historical inventory reference does not imply
that it is a current dependency.

The expected starting commit was `a1614a90bbd5f411117cbc2af0b058bedc4bccdd`.
The actual starting commit was `7e94e05ccde64c3bc62094811fae54602db143d3`,
whose direct parent is that expected commit. This intervening Replit Agent
commit added only the review paste listed below; no code, configuration, tests
or canonical documents changed. Its history is retained, not amended.

All three following text files were read completely before removal:

| Attachment under attached_assets/ | Bytes | SHA-256 | Disposition |
|---|---:|---|---|
| Pasted-Phase-2A-3-is-now-accepted-The-evidence-is-internally-c_1790124000415.txt | 12870 | 78106f1525638d29a50dfc2dc8dd134a0f71591b649151b583e8c0dec07e4345 | Removed tracked implementation/authorization prompt; recoverable from original functional commit |
| Pasted-The-Phase-2A-4-logic-appears-correctly-implemented-and-_1790125454732.txt | 4850 | ac298acb7678217af2996623c76a7030b8120b53eb6cb78fde68997f60c2c3d3 | Removed review/remediation prompt; unexpectedly already tracked by intervening commit |
| Pasted-The-stop-was-procedurally-correct-but-the-reference-is-_1790125698905.txt | 6687 | bf1f83b80b10437d855d3e0d0cafee82fa77fbfdd2d96a86315108ea1ffa8aa9 | Removed current untracked cleanup prompt without staging it |

The review and cleanup texts are already preserved in the conversation. They
contain process instructions, not unique application source data or distinct
business rules. Two pre-existing, byte-identical Phase 2A-2 verification-status
reports remain under attached_assets; they contain no implementation instructions
and are outside this correction. No broad attached_assets ignore rule was added.

### Memory findings and requirements provenance

Phase 2A-4 added one index entry to MEMORY.md and the file
pure-planning-boundary.md. The new file restated architecture/scheduling policy
from the implementation prompt; it contained no unique measurements, test
results or implementation evidence. The file and its index entry were removed.
Unrelated pre-existing memory entries were left unchanged.

Canonical webinar documents remain the authoritative product requirements.
Owner instructions authorize work and define phase-specific constraints.
This verification report records implementation choices and measured results;
it does not supersede canonical requirements or authorize further work.
Agent memory is not an alternative source of product policy or authorization.

The implementation section above retains the four offsets, all shortened-window
bands and immediate slot identities, local-calendar semantics, compatible DST
gap/overlap handling, 24-elapsed-hour separation, audience paths, weekday-only
business days, and planning-only containment. It also records the implementation
choice to retain historical obligation deadlines as overdue rather than as
backdated schedules, and that existing runtime weekend policy was not changed.

### Dependency and staging correction

The original manifest used the range ^0.5.1. The follow-up changes it to exact
version 0.5.1 for @js-temporal/polyfill. The package manager updates the lockfile
specifier to 0.5.1 while retaining resolved version 0.5.1 and jsbi 4.3.2.
No dependency upgrades or unrelated lockfile changes are intended.

Functional and corrective commits must stage an explicit, reviewed allowlist of
intended files, never unrestricted git add -A. An allowlist alone is insufficient:
each included file must also be within the authorized scope. Uploaded instruction
pastes must not be included just to obtain a clean working tree. The original
functional commit used explicit staging but incorrectly included its prompt.

No application source or tests are changed by this correction. No evaluator
expansion or subsequent functional phase is authorized or begun.

### Fresh Phase 2A-4B verification results

All requested gates were rerun after the exact-pin change. Actual runner totals:

| Suite | Files | Top-level tests | Nested subtests | Individual tests |
|---|---:|---:|---:|---:|
| Scheduling | 1 | 33 | 0 | 33 |
| Audience state | 3 | 63 | 0 | 63 |
| Business days/time | 4 | 30 | 0 | 30 |
| Planning containment | 1 | 3 | 0 | 3 |
| Classifier | 1 | 42 | 0 | 42 |
| Readiness | 1 | 44 | 0 | 44 |
| Exceptions | 1 | 172 | 0 | 172 |
| Evaluators | 1 | 20 | 0 | 20 |
| Registry | 1 | 9 | 0 | 9 |
| Existing structural | 1 | 8 | 0 | 8 |
| Catalog integrity | 2 | 65 | 0 | 65 |
| Complete API root suite | 14 | 69 | 0 | 69 |
| Frontend | 1 | 2 | 0 | 2 |
| **Total** | **32** | **560** | **0** | **560** |

Every gate exited zero. Failures, skipped, cancelled, todo, setup failures,
teardown failures and type errors: **0 each**. Non-incremental type checking
passed. Rule-ID generation reported **106 IDs and zero drift**. A fresh registry
inspection confirmed **15 implemented / 106 total, 91 missing**.

The fresh disposable database applied all 21 migrations listed in the original
report. Cleanup confirmed PostgreSQL shutdown, socket removal and temporary-root
removal; root absence was independently checked. All five canonical SHA-256
hashes were recomputed and matched the exact values recorded above.

API workflow rebuild/restart succeeded. Application sources, tests, canonical
documents, UI, database/migration code and runtime configuration are unchanged
from the original functional commit. No route, API, sending, publishing or
deployment integration was added. The dependency manifest and lockfile differ
only in the exact specifier; package resolutions and integrity records are
unchanged. MEMORY.md matches its pre-Phase-2A-4 contents byte for byte.

Verification commands:

```sh
# Each suite ran separately, with its relevant test path:
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap [test paths]
# Scheduling/audience/business-day/containment runs also used --test-concurrency=1.
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
pnpm --filter @workspace/api-server run typecheck --incremental false
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
```

Hash checks used Python SHA-256 with assertions against all five expected
digests. Runner summaries, zero-exit files and cleanup events were independently
parsed, rather than assuming the expected test total. Temporary logs:
`/tmp/phase4b-*.log`; exit codes: `/tmp/phase4b-*.exit`.

The cleanup commit stages exactly seven tracked paths: MEMORY.md, the deleted
pure-planning-boundary.md, the API package manifest, the two deleted tracked
instruction/review attachments, this report and pnpm-lock.yaml. The current
untracked cleanup prompt was deleted without staging. No pasted instruction
files remain in the resulting tree; the two unrelated historical status reports
described above remain.