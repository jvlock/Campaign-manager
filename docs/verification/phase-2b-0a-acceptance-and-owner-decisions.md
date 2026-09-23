# Phase 2B-0A — Baseline reconciliation and owner decision record

## 1. Scope and authority

This documentation-only increment closes the Phase 2B-0 lineage acceptance gate and
records the owner's five decisions and concurrent-execution requirements. The current
owner instruction authorizes this record; it does not authorize implementation here.
The Phase 2B-0 assessment and canonical webinar standards remain unchanged.

References:

- [Phase 2A-5G verified completion and full evaluator coverage](phase-2a-5g.md).
- [Phase 2B-0 integration assessment and build plan](phase-2b-0-integration-assessment.md),
  especially sections 2, 15–18. Its implementation inventory is incorporated by reference,
  not duplicated here. Its then-unresolved owner questions are resolved below to the
  stated extent; historical verification evidence in that report is not rewritten.
- `docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md` and
  `WEB-STANDARD-001.md`, including the private pilot, no real sending, and legacy boundaries.

## 2. Starting repository state

| Item | Observed value |
|---|---|
| Branch | `feature/webinar-standard-engine` |
| Phase 2A functional baseline | `12784a94bc46f86b1a37009c1ae83049554b057b` |
| Phase 2B-0 assessment commit | `09b8c9fdebfb3c3d051991d12e7693149a3e56f2` |
| Assessment's direct parent | `2ee7bc56440c6c249adb3992f239544324425c4b` |
| Actual starting HEAD | `8d7351a971f7b57f6d3873596aee774b341fd755` |
| Starting HEAD's direct parent | `09b8c9fdebfb3c3d051991d12e7693149a3e56f2` |
| Tracked working tree and index | Clean |
| Untracked files at start | Only `attached_assets/Pasted-Phase-2B-0-is-substantively-complete-but-one-acceptance_1790204043576.txt` |

The previous instruction upload is now tracked by the later platform commit described
below. The Phase 2B-0 completion response accurately described it as untracked at that
earlier instant; subsequent history explains the change. No upload or memory note is
deleted, staged, amended or rewritten by this increment.

## 3. Complete lineage reconciliation

`git merge-base --is-ancestor` returned 0 for the functional baseline → reported
assessment parent, and inspection shows a direct parent edge. Exactly **one** commit
intervenes in that exclusive-baseline/inclusive-parent range. No merge side branch or
additional hidden commit occurs in the range.

### 3.1 Every intervening commit

| Property | Value |
|---|---|
| Full hash | `2ee7bc56440c6c249adb3992f239544324425c4b` |
| Direct parent | `12784a94bc46f86b1a37009c1ae83049554b057b` |
| Title | Update verification commit policy documentation |
| Authoring timestamp | `2026-09-23T15:44:35Z` |
| Commit timestamp | `2026-09-23T15:44:35Z` |
| Every changed file | Modified `.agents/memory/verification-commit-policy.md` |
| Classification | Non-authoritative process-note commentary only |
| Tracking/supersession | Tracked before and after the commit; change remains present and is not superseded at starting HEAD |
| Phase 2A verified baseline impact | None |

The full diff adds advice to complement happy-path tests with adversarial checks of
scope, chronology, applicability, dependency edges and multiple participants. The note
explicitly calls this a verification practice, not an additional product rule. Its
anecdotal rationale is process commentary, not a test result, evidence artifact or
change to an accepted verification report. It changes no requirement, owner decision,
canonical rule, evaluator behavior, registry, source, test, dependency, configuration,
schema, migration, API, UI, integration, sending, publishing or deployment behavior.
No other file differs between the functional baseline and this parent.

### 3.2 Assessment commit and later HEAD movement

These are not intervening commits in section 3.1, but are included to reconcile the
complete path from the functional baseline to the actual starting HEAD.

| Full hash | Direct parent | Title | Authoring / commit timestamps (UTC) | Every changed file; classification |
|---|---|---|---|---|
| `09b8c9fdebfb3c3d051991d12e7693149a3e56f2` | `2ee7bc56440c6c249adb3992f239544324425c4b` | Document webinar engine integration plan | `2026-09-23T19:33:32Z` / `2026-09-23T19:33:32Z` | Added `docs/verification/phase-2b-0-integration-assessment.md`; authorized Phase 2B-0 assessment and verification report |
| `8d7351a971f7b57f6d3873596aee774b341fd755` | `09b8c9fdebfb3c3d051991d12e7693149a3e56f2` | Add webinar engine integration assessment documentation | `2026-09-23T19:33:44Z` / `2026-09-23T19:33:44Z` | Added `attached_assets/Pasted--Phase-2B-0-Webinar-Engine-Integration-Assessment-and-B_1790191016956.txt`; archived copy of the prior task instruction only |

Both added files are tracked and remain unsuperseded at starting HEAD. The latter
commit's title is not a reliable description of its contents: the changed-file list
and full content identify an instruction upload, not a modified assessment. It adds
no new requirement or decision beyond the already supplied Phase 2B-0 instruction.
The assessment commit itself is the authorized deliverable, not an unexplained
intervening modification to earlier verification evidence.

The chronological chain is:

```text
12784a94bc46f86b1a37009c1ae83049554b057b  Phase 2A functional baseline
  → 2ee7bc56440c6c249adb3992f239544324425c4b  process note only
  → 09b8c9fdebfb3c3d051991d12e7693149a3e56f2  Phase 2B-0 assessment only
  → 8d7351a971f7b57f6d3873596aee774b341fd755  prior instruction upload only
```

**Moving-baseline determination: satisfied.** The restricted intervening range contains
only an allowed process note; the subsequent HEAD movement contains only an allowed
instruction archive. No forbidden implementation, requirements or verification-evidence
change is concealed by either movement. No history manipulation is needed or performed.

## 4. Owner decisions — binding for future implementation

### Decision 1 — Neutral follow-up

A distinct neutral follow-up variant is approved when attendance remains unknown after
the authorized attendance-reconciliation period. The existing canonical reconciliation
period is not changed by this record.

- It must not state or imply that the recipient attended.
- It must not state or imply that the recipient was absent.
- It must remain distinct from the attended and absent variants.
- It may provide the webinar recording, related content, or an authorized next step.
- The concept is approved; customer-facing copy must still pass normal content and
  compliance approval.
- A placeholder or unapproved draft cannot be used for live sending.
- If approved neutral content is unavailable when required, live follow-up readiness
  remains blocked.

No customer-facing copy is written or approved by this increment. Concept approval
does not authorize sending, change eligibility timing, or grant provider access.

### Decision 2 — Foundation authority and provenance

Governance Foundation remains authoritative for governed taxonomy, standardized
internal naming, campaign codes, UTM generation and applicable governed classifications.

A Foundation result supports operational readiness only when its record includes:

1. Producing service or authoritative repository.
2. Exact service or ruleset version.
3. Effective taxonomy version.
4. Request or transaction reference.
5. Input fingerprint.
6. Calculation timestamp.
7. Result provenance.
8. Status and validity.
9. Applicable activity, communication and content references.

Manual entry, locally recreated logic or a documented dependency cannot substitute for
governed Foundation output. When Foundation is unavailable, draft planning may continue
and existing valid governed results may be displayed according to their validity rules,
but Foundation-dependent operational readiness must fail closed. Sending or publishing
cannot bypass the missing governed result. Display of a cached result is not a blanket
readiness permission or permission to use an expired result.

Implementation must distinguish **evaluator implemented**, **governed observation
available**, and **live Foundation integration connected**. This decision defines the
authority and evidence contract; it does not claim a production connection exists.

### Decision 3 — Minimum authorization roles

| Role | Minimum responsibility and boundary |
|---|---|
| Planner | Creates and edits webinar plans and submits evidence |
| Exception Requester | Requests an exception but cannot approve the same request |
| Independent Reviewer | Approves or denies eligible exceptions and required evidence |
| Operations Executor | Performs authorized operational actions only after readiness requirements are satisfied |
| Administrator | Manages access and configuration, but cannot override non-overridable rules merely because the user is an administrator |
| Read-only Viewer | Inspects plans, findings, readiness and audit history without changing them |

- Real authentication must supply the user identity.
- Self-approval of exceptions is prohibited.
- Exception request and approval must remain separate auditable actions.
- `WEB-EXC-001` and other non-overridable controls cannot be bypassed by any role.
- Unverified names or manually entered reviewer identities cannot support live approval.
- Readiness overrides outside the approved exception mechanism are prohibited.
- Authorization must be enforced server-side, not only in the UI.
- If current authentication cannot support these controls, operational execution remains
  disabled.

This settles the minimum role/control model, not its implementation or assignment of
real people. It does not introduce an administrator bypass or expand the pilot's
operational permissions.

### Decision 4 — Differentiated retention

These baselines are subject to any longer MSCI legal, privacy, records-management or
litigation-hold requirement:

| Record category | Baseline retention |
|---|---|
| Exceptions, approvals, denials and separation-of-duties evidence | 7 years |
| Standard version, evaluator fingerprint, release fingerprint and provenance | 7 years |
| Operational execution and suppression audit records | 7 years |
| Completion and material readiness snapshots used for an operational decision | 7 years |
| Recomputable evaluation diagnostics not used as decision evidence | 24 months |
| Temporary request-local diagnostics | Do not persist beyond operational troubleshooting needs |
| Participant PII | Governed by its authoritative source and applicable corporate privacy schedule |

- Do not duplicate participant PII merely to support evaluation.
- Prefer durable identifiers, hashes and authoritative-source references where sufficient.
- Deletion of source PII must not destroy required non-PII audit evidence.
- Legal holds override scheduled deletion.
- Retention periods must be configurable rather than embedded throughout application code.

No retention job, data deletion or schema change occurs here. Corporate schedule
application and legal-hold procedures remain implementation dependencies, not permission
to invent a separate PII retention period.

### Decision 5 — Legacy sessions

- Active legacy sessions remain unchanged through completion.
- They are not automatically migrated to the new standard.
- Historical communications and outcomes remain auditable.
- The new standard applies to newly created sessions after the authorized cutover.
- Any future legacy migration requires a separately assessed and approved migration plan.

This confirms rather than reopens the canonical pilot policy for `legacy_9` and
`default_5`: retain their original versions through completion, no mid-cycle upgrade,
and apply the new standard to new creation only after required pilot verification
and authorized cutover. Preserve historical templates; do not delete them.

## 5. Concurrent-execution requirements

The following are binding requirements for future implementation:

- Completion diagnostics must be request-local and must not rely on mutable shared state.
- Release fingerprints must identify the exact standard version, evaluator registry,
  implementation release and relevant governed dependencies.
- Whole-population operations must return complete, deterministic result sets rather
  than silently truncating, sampling or returning only the first page.
- Concurrent requests must not leak diagnostics, evidence, exceptions or results between
  webinars or users.

These resolve architectural direction, not implementation. The assessment's
participant-level result preservation and unique-ID completion-envelope concerns still
require a verified orchestration contract. No concurrent execution code is changed here.

## 6. Remaining external dependencies and boundaries

- Approved customer-facing neutral copy and its normal content/compliance approval record.
- Concrete authoritative Foundation service/repository, versioned transport contract,
  trusted provenance verification, availability/validity handling and connection access.
- Real authentication and server-side enforcement of the approved roles, campaign scope,
  reviewer independence and auditable identities. Until supported, execution is disabled.
- Applicable corporate privacy schedules, records-management and legal-hold procedures,
  retention configuration and source-PII/non-PII audit separation.
- Pilot verification and authorized new-session cutover; any future legacy migration
  requires separate approval.

These do not prevent documentation acceptance or authorized Phase 2B-1 work within its
scope. They still block dependent operational readiness or cutover where required.
This record does not authorize external sending, publishing, deployment, a new provider
integration, production-data changes, or implementation during this increment.

## 7. Fresh verification results

All requested gates passed after creation of this decision record. These are fresh
measurements, not historical counts substituted for current results.

### 7.1 Commands and runner accounting

```sh
git merge-base --is-ancestor 12784a94bc46f86b1a37009c1ae83049554b057b 2ee7bc56440c6c249adb3992f239544324425c4b
git merge-base --is-ancestor 2ee7bc56440c6c249adb3992f239544324425c4b HEAD
git rev-list --count 12784a94bc46f86b1a37009c1ae83049554b057b..2ee7bc56440c6c249adb3992f239544324425c4b
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
pnpm --filter @workspace/api-server run typecheck --incremental false
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*/*.test.ts'
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
```

Both ancestry checks returned 0; the intervening range count was exactly 1. Full
chronological log, file-status and diff inspection produced sections 2–3. An initial
log-range command contained a mistyped hash and failed without changing anything;
the corrected command used the full actual hashes and produced the complete inventory.
This was an inspection-command correction, not a verification-suite failure.

| Suite | Test files | Top-level runner records | Nested subtests | Total TAP records | TAP grouping records | Individual leaf tests |
|---|---:|---:|---:|---:|---:|---:|
| Complete domain suite | 35 | 3,081 | 7 | 3,088 | 1 | 3,087 |
| Complete API suite | 14 | 69 | 0 | 69 | 0 | 69 |
| Frontend regression | 1 | 2 | 0 | 2 | 0 | 2 |
| **Total** | **50** | **3,152** | **7** | **3,159** | **1** | **3,158** |

The complete domain glob includes catalog, evaluator, evidence, exception, readiness,
scheduling, audience and completion suites. The frontend command runs the existing
regression suite; it is not a claim of new browser, mobile or accessibility testing.
The one parent grouping record is included among the domain top-level/TAP records;
its seven children are nested subtests. Removing the grouping record gives the leaf
count. Totals match Phase 2B-0 because sources and tests remain unchanged.

| Result | Count/status |
|---|---|
| Failures | 0 |
| Skipped tests | 0 |
| Cancellations | 0 |
| TODOs | 0 |
| Setup failures | 0 |
| Teardown failures | 0 |
| Non-incremental type errors | 0 |
| Domain/API/frontend/typecheck/drift command exits | All 0 |
| Rule-ID drift | `RULE_IDS_OK: check; 106 rules`; zero drift |

### 7.2 Disposable database and all 21 migrations

The API suite used a new isolated database through the existing disposable harness,
including its existing pre-0001 foundation fixture. No application or production
database was changed. Each of the following reported successful `migration-applied`:

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

The verifier returned `allMigrations:true`, `migrationCount:21`,
`after0016Present:true`, `registration_unique:true`, `scheduled_constraint_named:true`
and `taxonomy_active:true`.

Cleanup for `/tmp/disposable-pg-b1NLcf` reported `reason:"normal"`,
`postgresStopped:true`, `socketRemoved:true`, and `tempRootRemoved:true`.
An independent filesystem check confirmed the temporary root no longer existed.
No cleanup failure occurred. This does not change the assessment's documented
production migration caveats or authorize deployment.

### 7.3 Canonical hashes, Temporal pin and registry

Fresh byte-for-byte comparisons against functional commit
`12784a94bc46f86b1a37009c1ae83049554b057b` passed for all five files.

| File under `docs/standards/webinar/` | SHA-256 |
|---|---|
| `WEB-STANDARD-001.rules.json` | `7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2` |
| `WEB-STANDARD-001.md` | `74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25` |
| `WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md` | `87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f` |
| `CHANGELOG-RC1.md` | `b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c` |
| `manifest.json` | `8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859` |

The API manifest dependency and lockfile importer specifier/resolved version remain
exactly `@js-temporal/polyfill` **0.5.1**, with no range or dependency change.

Fresh runtime inspection imported `catalog` and `registry` from
`artifacts/api-server/test/evaluation/fixtures.ts` through
`pnpm --filter @workspace/api-server exec tsx --input-type=module -e`.
It compared canonical rule IDs and `registry.implementedRuleIds` in both directions
and checked uniqueness, returning:

```json
{"canonical":106,"implemented":106,"missing":[],"unknown":[],"duplicate":0}
```

Coverage remains **106/106**. Implemented evaluators do not constitute operational
readiness, approved content, authentication or a live Foundation connection.

### 7.4 Source containment and working tree

Before staging, `git diff --exit-code` against starting HEAD returned 0: no tracked
file changed. The only untracked files were this new decision record and the current
instruction upload. Consequently no application, test, configuration, schema,
migration, route, API, UI, dependency, canonical standard or existing verification
report changed. No runtime integration, sending, publishing or deployment work occurred.

The decision record alone is allowlist-staged, checked with `git diff --cached --check`,
and verified by the staged changed-file list before commit. After commit, the required
tracked state is clean and the current instruction upload remains untracked. The final
commit identity and actual changed-file/working-tree results are reported in the
completion response.

Execution logs were captured under `/tmp/phase2b0a/`; this record preserves results
without relying on temporary-log retention.

### 7.5 Acceptance and authorization

**Phase 2B-0 is formally accepted.** The lineage gate is satisfied, the owner decisions
are recorded, and every fresh verification gate passed.

**Phase 2B-1 is authorized to begin under the approved scope and constraints.**
This authorization is conditional on retaining those passing gates and following
the decisions, canonical rules and dependency boundaries above; it does not expand
the approved pilot into real sending, publishing or deployment.

Acceptance is for the integration assessment, not for a completed operational pilot.
No Phase 2B-1 implementation has begun. This increment stops after reporting.

## 8. Commit boundary

Only `docs/verification/phase-2b-0a-acceptance-and-owner-decisions.md` may be committed,
with title `Record webinar integration owner decisions`. Expected direct parent is the
starting HEAD `8d7351a971f7b57f6d3873596aee774b341fd755`; any movement must first be
inspected. The ending SHA is reported after commit rather than embedded self-referentially.
The current instruction upload remains untracked. No implementation work occurs.