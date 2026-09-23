# Phase 2A-5B — Evidence foundation and Setup evaluators

## Scope and starting state

Implemented the reusable in-memory evidence foundation and exactly the 23 Batch 1 rules from the committed coverage plan. No evaluator from Batches 2–6 was added.

* Branch: `feature/webinar-standard-engine`.
* User-accepted starting commit: `8430478205da7d3ef6b6711ffd2afcf20d3d2d29`, parent `08479495730af0debcf58ebf0f85cbb64d213a86`.
* Observed implementation starting HEAD: `8f01c76b0d24522fd861427ba6360c3a290cdd89`, parent `8430478205da7d3ef6b6711ffd2afcf20d3d2d29`. The intervening checkpoint added only the current instruction upload; no code, standard or coverage-plan changes occurred. It was disclosed before proceeding. History was not rewritten.
* Ending commit: the commit containing this report, titled `Add webinar setup evaluators and evidence model`; its exact SHA is supplied in the completion response.
* Fresh baseline: 106 canonical/generated IDs, 15 implemented, 91 missing, exact 23-rule Setup membership; 32 test files and 560 passing individual/top-level tests, zero nested subtests, failures, skips, cancellations or TODOs. Non-incremental API typecheck passed. All five canonical hashes matched.
* `@js-temporal/polyfill` remains exactly `0.5.1` in the manifest and lockfile. No dependency change.

## Authorized deletion

Deleted only:

`attached_assets/Pasted-Phase-2A-4-is-now-fully-accepted-The-functional-impleme_1790126137350.txt`

The complete file was read and confirmed to be the previously delivered assessment prompt. Its SHA-256 before deletion was:

`5506533ec77d9ab4d2368236821f117b5fe548f79f9e247064870beeae50ed6f`

It was tracked by the preceding checkpoint, not untracked. The user explicitly authorized this tracked deletion and prohibited history rewriting. The newer upload was already tracked by the additional checkpoint and is preserved unchanged; this implementation commit adds no uploaded prompt.

Subsequent hygiene inventory: the newer instruction upload,
`attached_assets/Pasted-The-assessment-is-accepted-The-three-product-decisions-_1790127344254.txt`,
was originally added by `8f01c76b0d24522fd861427ba6360c3a290cdd89` and subsequently removed by the separately authorized cleanup commit `bff042fba5b28c05b3a1a897fe1b40c2387bcf9e`. Its SHA-256 was `3a301e4579fd16531d582dc0f00eb9143df393b73a1ea3a5962cab46e8babb90`. It remains recoverable from Git at its original commit; no history was rewritten. This inventory correction does not change the Phase 2A-5B verification evidence or product decisions.

## Resolved decisions

The coverage plan's decision register now records the approved resolutions and distinguishes them from the historical assessment:

* **D1 / WEB-DONE-001:** failed advisories stay visible and do not prevent Complete. Unresolved applicable blockers, missing required obligations/blocker evidence/evaluator coverage, and unresolved completion dependencies prevent completion.
* **D2 / WEB-REG-005 and WEB-REG-006:** always-material attendance changes versus participant-facing changes material only after publication/communication; internal administrative changes do not create notices. Obligations arise when the change is recorded, due within one elapsed hour or by event start if sooner. Late obligations are overdue, never backdated. No sending is authorized.
* **D3 / WEB-FU-ATT-001:** the clock starts at recorded actual event completion, with no extension for late attendance data; missing completion time is unavailable evidence. Monday–Friday in the event time zone, without holidays.

These four later-batch evaluators and their scheduling/audience-state behavior were **not** implemented.

## Evidence foundation

New pure APIs:

* `validateManualEvidence(input, context)`
* `validateManualEvidenceCollection(input, context)`

The readonly model includes an immutable evidence ID, canonical rule/standard/exact version, evidence status and description, supplier name or pilot identifier with literal `identityVerified: false`, supplied/effective/expiration timestamps, source/attachment references, exact event/session/participant/communication/deliverable scope and notes. Binding includes input snapshot/artifact versions, review time, completeness and observation bounds.

Validation rejects unknown rule IDs, wrong standard/version, missing or duplicate evidence IDs, mismatched scope, missing/nonfinite/future timestamps, expired evidence, malformed or out-of-scope source references and verified-identity claims. Collection validation is atomic, including identical duplicate IDs. Accepted data and errors are defensively copied and deeply frozen without freezing or mutating caller input. The caller supplies observation time; there is no automatic clock or environment access.

Validation establishes admissible evidence, not a rule pass. Confirmed evidence cannot override a separate rule violation. Rejected, incomplete and unavailable evidence states remain explicit. Integration tests exercise actual rule evaluation, exception validation and readiness: evidence supports evaluation, cannot resolve a failure, and cannot make an exception substitute for unavailable evidence. A valid exception preserves the original failed finding. Expired/mismatched evidence remains unavailable.

No persistence, authentication, upload capability, external integration or executable delivery capability was added.

## Result semantics and readiness

The minimum additive status is `evidence_unavailable`, paired with existing reason `missing_evidence`. Existing `pass`, `fail`, `not_applicable` and `unimplemented` statuses remain. Invalid context remains `fail` with reason `invalid_context`; evaluator unavailability remains `unimplemented`/`not_implemented` with missing coverage. Legacy evaluator missing-evidence helpers now emit the new unavailable status, rather than asserting failure without evidence.

`StageReadinessResult` adds `unassessedBlockers` and `unassessedAdvisories`:

* Mandatory/Conditional blocker evidence unavailable → incomplete.
* Confirmed unresolved blocker failure → blocked, retaining other evidence gaps and `fullyEvaluated: false`.
* Advisory evidence unavailable → visible, unassessed and nonblocking; not independently incomplete.
* Failed advisory → visible and nonblocking.
* Missing evaluator → missing coverage/incomplete.
* Not applicable → nonblocking.
* An exception cannot target evidence-unavailable findings. Valid exception resolution preserves `originalFailure`; no pass conversion.

The existing blocking classifier was not weakened. Incoming findings require coherent statuses/reasons and exact canonical metadata; prototype-property status names are rejected.

## Exact 23 implemented rules

```text
WEB-SETUP-001
WEB-SETUP-002
WEB-SETUP-004
WEB-SETUP-005
WEB-SETUP-006
WEB-SETUP-007
WEB-SETUP-008
WEB-SETUP-009
WEB-SETUP-010
WEB-SETUP-011
WEB-SETUP-013
WEB-SETUP-014
WEB-SETUP-015
WEB-SETUP-016
WEB-SETUP-017
WEB-SETUP-018
WEB-SETUP-020
WEB-SETUP-C01
WEB-SETUP-C05
WEB-RDY-REC-001
WEB-RDY-REC-007
WEB-QA-008
WEB-MEAS-001
```

Each has an explicit evaluator or adapter and an explicit registry entry. `createSetupEvaluators(catalog)` binds prerequisite validation to the validated runtime catalog; metadata is not reconstructed from naming conventions. Canonical rule-specific failure messages, resolution guidance and exception eligibility remain on each registry result.

Shared predicates/helpers: `checked`, `requiredText`, `anyText`, `textField`, `nonblank`, `absent`, `combine` and catalog-bound `prerequisites`. Date/time checks reuse `assertInstant`, `assertTimeZone`, `localTime` and deterministic Temporal date/time parsing. No scheduling or audience-state calculation was copied or changed.

Setup date validation is future-or-same-day **local date**, not a blanket future-event-instant requirement. Same-day elapsed starts, DST gaps/overlaps and local-midnight boundaries are covered. Missing evidence is unavailable; confirmed absence in a complete snapshot fails a required field; malformed values are invalid context.

Readiness wrappers consume full, scope/version/observation-bound prerequisite findings with exact canonical metadata, coherent status/reason and duplicate checks. Missing, partial or unimplemented prerequisites cannot pass. Wrappers do not recursively call aggregate readiness or implement later-batch leaves. In the real current registry, later-batch prerequisites can still leave Setup readiness unavailable: **implementation coverage is not operational readiness**.

## Context additions

Only optional readonly Batch 1 context envelopes were added to `EvaluationContext`:

* `setup`: event/snapshot identity, completeness, activity type and requested evaluation stage; title, topic/description, intended audience, local date/start time, duration, IANA zone, format, platform/location, registration destination, activity/recruitment/follow-up owners, primary/follow-up CTAs, measurement target IDs, registration opening/closing rules, capacity applicability/value, non-default-language applicability and language.
* `measurementPlan`: matching event/snapshot identity and completeness, description and defined targets (`targetId`, `metric`, numeric target, unit).
* `findingEvidence`: standard/version/event/snapshot/observation identity and completeness, setup and owner prerequisite results.

The requested stage is evaluation context, not a manually set authoritative readiness state. No session attendance field, database model, invented taxonomy, authentication claim or governed-service bypass was added.

## Mechanical coverage reconciliation

Independent verification loaded the actual runtime registry, generated ID inventory, canonical catalog and exact Batch 1 list from the committed plan:

| Check | Result |
| --- | ---: |
| Canonical/generated IDs | 106 |
| Original implemented IDs retained | 15 |
| New Batch 1 IDs | 23 |
| Registered evaluators | **38** |
| Missing evaluators | **68** |
| Duplicate or unknown evaluator IDs | 0 |
| Missing Batch 1 IDs | 0 |
| New evaluator IDs outside Batch 1 | 0 |

Registry tests independently reconcile plan rows and retain deterministic metadata/results. The 14 existing semantic controls remain classified 10 evaluator-backed / 2 structural / 2 containment, with their 15 mapped IDs a subset of the 38 registered IDs; structural controls were not converted into meaningless new evaluators.

## Final verification

| Test group | Files | Top-level records | Nested subtests | TAP total | Individual leaf tests |
| --- | ---: | ---: | ---: | ---: | ---: |
| Domain suites, including evidence, Setup, coverage, readiness, exceptions, existing evaluators, scheduling, audience, time, containment and catalog | 20 | 716 | 7 | 723 | 722 |
| Complete API suite on a new disposable database | 14 | 69 | 0 | 69 | 69 |
| Frontend regression suite | 1 | 2 | 0 | 2 | 2 |
| **Total** | **35** | **787** | **7** | **794** | **793** |

All **794 TAP test records passed**. There is one top-level grouping test containing seven subtests; excluding that grouping record gives **793 individual leaf tests**. Counts are not forced to the baseline total.

Final failures, skips, cancellations, TODOs, setup failures, teardown failures and type errors: **zero**.

The first full domain pass found two outdated containment-test assumptions: old 15/91 counts and an import allowlist that predated deterministic Setup time helpers. Only that test file was corrected. It retains the semantic-control distinction, admits exact named pure dependencies, scans the new evidence folder and admitted time helper, and adds negative probes against ambient clocks, environment/I/O access, dynamic imports and randomness. The complete domain rerun passed. The already-passing API run remained valid after this test-only correction.

Commands:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*/*.test.ts'
pnpm --filter @workspace/api-server run typecheck --incremental false
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
```

The non-incremental typecheck passed. Rule-ID drift check passed for all 106 IDs. Read-only source review found no additional correctness issue. The existing API workflow rebuilt/restarted successfully; the unchanged workspace rendered normally with no browser errors in the preview check. No API integration or UI feature was added.

### Disposable database

All 21 existing migrations applied successfully to the fresh isolated test database:

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

Cleanup records confirmed PostgreSQL stopped and both the temporary database root and socket were removed; the root's absence was independently checked. No retained database changed. No migration was created or modified.

### Canonical SHA-256

All five hashes match the starting bytes:

| File under docs/standards/webinar | SHA-256 |
| --- | --- |
| WEB-STANDARD-001.rules.json | `7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2` |
| WEB-STANDARD-001.md | `74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25` |
| WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md | `87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f` |
| CHANGELOG-RC1.md | `b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c` |
| manifest.json | `8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859` |

## Exact changed-file allowlist

```text
artifacts/api-server/src/lib/webinar-standard-evaluation/evaluators.ts
artifacts/api-server/src/lib/webinar-standard-evaluation/index.ts
artifacts/api-server/src/lib/webinar-standard-evaluation/registry.ts
artifacts/api-server/src/lib/webinar-standard-evaluation/types.ts
artifacts/api-server/src/lib/webinar-standard-evaluation/setup-evaluators.ts
artifacts/api-server/src/lib/webinar-standard-evaluation/setup-types.ts
artifacts/api-server/src/lib/webinar-standard-evidence/index.ts
artifacts/api-server/src/lib/webinar-standard-evidence/types.ts
artifacts/api-server/src/lib/webinar-standard-evidence/validate.ts
artifacts/api-server/src/lib/webinar-standard-readiness/aggregate.ts
artifacts/api-server/src/lib/webinar-standard-readiness/claims.ts
artifacts/api-server/src/lib/webinar-standard-readiness/result-validation.ts
artifacts/api-server/src/lib/webinar-standard-readiness/types.ts
artifacts/api-server/test/evaluation/evaluators.test.ts
artifacts/api-server/test/evaluation/registry.test.ts
artifacts/api-server/test/evaluation/setup-evaluators.test.ts
artifacts/api-server/test/evaluation/structural-containment.test.ts
artifacts/api-server/test/evidence/exception-separation.test.ts
artifacts/api-server/test/evidence/validation.test.ts
artifacts/api-server/test/readiness/classifier.test.ts
artifacts/api-server/test/readiness/fixtures.ts
artifacts/api-server/test/readiness/readiness.test.ts
attached_assets/Pasted-Phase-2A-4-is-now-fully-accepted-The-functional-impleme_1790126137350.txt
docs/verification/phase-2a-5-evaluator-coverage-plan.md
docs/verification/phase-2a-5b.md
```

The listed older upload is a deletion; new files are the Setup implementation/types/test, evidence module/tests and this verification report. Other entries are updates. Explicit staging is limited to this allowlist.

## Completion boundary

All 23 requested evaluators are implemented; none stopped on an unresolved product decision. Required manual/governed/later-batch prerequisite evidence may remain unavailable, as designed. Coverage is **38/106**, with **68 still missing**.

No later-batch evaluator, governance integration, scheduling/audience change, database persistence/migration, route/API integration, UI, authentication, sending, publishing, deployment, workbook ingestion or product-policy memory file was added. The remaining pilot is not declared complete. Stop after reporting this phase.