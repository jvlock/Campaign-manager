# Phase 2B-0 — Webinar engine integration assessment and build plan

## 1. Purpose, authority, and conclusion

This document is an assessment and sequenced build plan.
It does not implement persistence, migrations, routes, services, UI, external integrations, sending, publishing, or deployment.

The authoritative inputs are:

- `docs/standards/webinar/WEB-STANDARD-001.md`;
- `docs/standards/webinar/WEB-STANDARD-001.rules.json`;
- `docs/standards/webinar/manifest.json`;
- `docs/standards/webinar/CHANGELOG-RC1.md`;
- `docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md`;
- the Phase 2A verification reports under `docs/verification/`;
- the current schema, all 21 migrations, application code, tests, and UI.

The attached Phase 2B-0 instruction defines assessment scope only.
Files under `.agents/memory/` are not product requirements or implementation evidence.

The principal conclusion is that the 106-rule in-memory evaluator can be integrated without a parallel webinar model.
Future adapters should read the existing Campaign, Activity, webinar session, communication, scheduling, deliverable, registration, and attendance authorities.
They should add only missing source facts, typed evidence/history, exception records, and version-bound evaluation snapshots.
The evaluator remains descriptive-only; it is neither an execution permission nor a sending service.

No external send is authorized.
No legacy webinar migration or mid-cycle upgrade is authorized.
Foundation remains authoritative for governed taxonomy, naming, campaign code, and UTM output.

## 2. Repository and baseline evidence

### 2.1 Starting state

| Item | Observed state |
|---|---|
| Branch | `feature/webinar-standard-engine` |
| Expected functional commit | `12784a94bc46f86b1a37009c1ae83049554b057b` |
| Starting `HEAD` | `2ee7bc56440c6c249adb3992f239544324425c4b` |
| Direct parent | `12784a94bc46f86b1a37009c1ae83049554b057b` |
| Tracked working tree at assessment start | Clean |
| Untracked scope instruction | `attached_assets/Pasted--Phase-2B-0-Webinar-Engine-Integration-Assessment-and-B_1790191016956.txt`; never stage |
| Intended document parent | `2ee7bc56440c6c249adb3992f239544324425c4b`, unless a concurrent `HEAD` move is reported and assessed |

The sole intervening commit changes only
`.agents/memory/verification-commit-policy.md`.
It adds duplicated, non-authoritative review-process commentary and changes no application code, tests, dependency, configuration, canonical standard, schema, migration, API, UI, product requirement, verification evidence, or evaluator registry.
The moved baseline is therefore acceptable under the moving-baseline policy.
History was not rewritten.

### 2.2 Process-memory note disposition

| Check | Result |
|---|---|
| Exact path | `.agents/memory/verification-commit-policy.md` |
| Size | 1,620 bytes |
| SHA-256 | `a9e1d6c21eadde9b345ed7b4da230096ab356fd89b3ffa6048fcdeb1ff54b9ca` |
| Read completely | Yes |
| Unique product requirement | None |
| Unique implementation evidence | None |
| Unrecorded product decision | None |
| Application data | None |
| Content classification | Duplicated, non-authoritative review-process commentary |
| References | Only the `MEMORY.md` index |
| Git state | Tracked, already platform-committed, no unstaged change |
| Disposition | Preserve; untracked-only deletion authorization does not apply |

No deletion was authorized or made.

### 2.3 Confirmed baseline verification

The baseline run is confirmed as follows:

| Suite | Files | Top-level | Nested | TAP records | Leaf tests |
|---|---:|---:|---:|---:|---:|
| Domain/evaluator | 35 | 3,081 | 7 | 3,088 | 3,087 |
| API | 14 | 69 | 0 | 69 | 69 |
| Frontend | 1 | 2 | 0 | 2 | 2 |
| Overall | 50 | 3,152 | 7 | 3,159 | 3,158 |

The overall difference between 3,159 TAP records and 3,158 leaf tests is one grouping record.
There were zero failures, skips, cancellations, TODOs, setup failures, teardown failures, or type failures.
The rule-ID check reported 106 generated IDs and zero drift.
The evaluator registry reported exactly 106 IDs, `missing=[]`, `unknown=[]`, and zero duplicates.
One ad hoc `tsx` inspection command initially failed because CommonJS did not support top-level `await`;
the corrected inspection used `--input-type=module`.
That command correction was not a test-suite failure.

All 21 migrations succeeded with `allMigrations: true`, `after0016Present: true`, and `count: 21`.
The baseline disposable database `disposable-pg-bs5rna` was stopped;
its socket and temporary directory were removed, and independent absence checks passed.
All five canonical hashes match the functional commit.
The manifest and lock data retain `@js-temporal/polyfill` exactly at `0.5.1`.

Runtime-containment inspection from catalog pre-parent
`9110a437a83325f98a6d3abd9e1f7d1e9c71baee`
through functional commit `12784a94bc46f86b1a37009c1ae83049554b057b`
showed no changes under `lib/db`, API routes/application wiring,
`artifacts/campaign-workspace`, API specification/client/Zod surfaces.
Phase 2A therefore introduced no persistence, route, application API, UI,
sending, publishing, Foundation connection, or deployment behavior.

The complete post-document gate also passed; its separately measured results, commands,
canonical hashes, migration results, and cleanup evidence are recorded in section 18.
The canonical loader/catalog tests validate the normalized rule records, required metadata,
exact `WEB-STANDARD-001` / `1.0-pilot-rc1` identity, uniqueness and catalog integrity;
the preflight is not merely an assertion that a generated list contains 106 strings.

## 3. Existing implementation inventory

### 3.0 Path and code-location conventions

All abbreviated paths in this assessment resolve under these inspected roots:

- API libraries/services: `artifacts/api-server/src/lib/`;
- API routes: `artifacts/api-server/src/routes/`;
- Campaign Workspace webinar/map UI: `artifacts/campaign-workspace/src/components/map/`;
- API tests: `artifacts/api-server/test/`;
- Drizzle schema: `lib/db/src/schema/`;
- SQL migrations: `lib/db/migrations/`.

A statement that authentication, a provider, a worker, or a route was not found is scoped to
the current inspected repository and these application roots.
It is not a claim about systems outside this repository.

### 3.1 Core hierarchy and identity

| Category | Files, tables, keys, and constraints | Services/routes/UI/tests | Ownership, source of truth, and gaps |
|---|---|---|---|
| Campaign | `lib/db/src/schema/campaign.ts`; `campaigns.id`; optional `parent_id`; name, scope, region, audience, outcome, lifecycle, readiness, timing, owner, generated normalized name, `row_version`, timestamps; `campaign_regions`; singleton `campaign_strategy` | `artifacts/api-server/src/routes/campaigns.ts`: `GET/POST/PATCH /campaigns`, `PUT /campaigns/:id/map`; Engagement Map; campaign/activity route tests | Campaign row owns identity. `readiness` is a legacy/manual integer, not engine authority. `parent_id` is not a Journey model and has no discovered self-FK. |
| Journey | No Journey table, `journey_id`, route, service, or UI entity in schema/migrations | Activity connections and audience branches can depict branching, but must not be relabeled as a Journey | Optional Journey layer is absent. Do not infer a Journey from graph edges or campaign parentage. |
| Activity | `activities.id`, required `campaign_id`, type/name/audience/region/timing/status/owner, `activity_type_id`, answers, overrides, `generated_name`, `naming_input`, `effective_inheritance`, `row_version`; unique `(id,campaign_id)` | `POST /campaigns/:id/activities`; map update; `validateActivityModel`, `activityConfiguration`, `renderActivityName`, `ensureWebinarForActivity`; `activity-model*.test.ts` | Activity is authoritative for webinar placement. Webinar routes reject a non-governed or manually named activity. |
| Connections/tasks | `activity_connections`; `activity_tasks`; `activity_task_settings.activity_id` PK with event/launch planning fields | Campaign map update protects linked tasks; delivery task routes and planning UI | Connections model map topology, not Journey identity. Tasks/settings are implementation planning, not immutable engine setup evidence. |
| Communication/Touch | `communications.id`, required `campaign_id` and `activity_id`, name/type/timing/sort/status/owner; unique `(id,campaign_id)`; `communication_details` one-to-one | `artifacts/api-server/src/routes/delivery.ts`; `lib/delivery.ts`; map and `WebinarStandardPanel`; `delivery.test.ts` | Existing Touch representation. Base declaration/migration history must be read together for required association and campaign-safe FKs. |
| Generic Deliverable | No polymorphic `deliverables` table | Resource-specific assets, landing pages, and CTAs are used instead | Approved hierarchy is only partially represented because no universal Touch-to-Deliverable contract exists. Do not create a parallel generic entity without a later design decision. |

### 3.2 Webinar, occurrence, participants, and state

| Category | Current implementation | Lifecycle/source of truth | Gaps |
|---|---|---|---|
| Webinar occurrence | `lib/db/src/schema/webinar.ts`; `webinar_sessions`: `id`, `campaign_id`, `activity_id`, `name`, `session_date`, `start_time`, `duration_minutes`, `timezone`, `platform`, speakers JSON, `recruitment_launch_at`, registration-rule JSON, `template_version`; unique `(campaign_id,activity_id,name)` and `(id,campaign_id)` | One local session row is the occurrence. Campaign/activity composite FK prevents cross-campaign attachment. Create/update routes own writes. | No occurrence history, external/provider occurrence ID, or event lifecycle `status`. |
| Template generation | `webinar_sessions.template_version`; values `legacy_9` and `default_5` | Persisted template family/generation for each session | Not the exact `WEB-STANDARD-001` identifier/version, catalog hash, evaluator fingerprint, or engine release. |
| People | `webinar_people`: `id`, `campaign_id`, `audience_branch_id`, `name`, `is_synthetic`; unique `(campaign_id,name)`, `(id,campaign_id)`; synthetic check | Campaign-scoped planning participant/branch record | No real contact/CRM identity, external linkage, address, opt-out, invalid-address, or durable audience-class state. |
| Registration | `webinar_registration_results`: campaign/session/person, `result`, `recorded_at`, nullable `first_registered_at`, timestamps; unique `(session_id,person_id)` | Current projection; result check permits only `registered` or `not_registered` | No immutable transition ledger, cancellation, waitlist, source event ID, provenance, or history. |
| Attendance | `webinar_attendance_results`: campaign/session/person, `result`, `recorded_at`, timestamps; unique `(session_id,person_id)` | Current per-registrant fact; result check permits only `attended` or `no_show` | No `unknown`, interval/duration, provider event, correction history, source/provenance, or reconciliation state. |
| Event status | No session status column/table | None | Must remain distinct from participant state; missing persistence. Do not derive it from registration or attendance. |
| Participant status | Registration and attendance projections plus synthetic-person flag | Split current facts | Cannot represent all canonical registered/waitlisted/cancelled/attended/absent/unknown/internal/test states safely. |

### 3.3 Planning, communications, suppression, and execution

| Category | Current implementation | Lifecycle/source of truth | Gaps |
|---|---|---|---|
| Standard config | `webinar_standard_configs`, one per session; pilot limits and variants JSON | `ensureWebinarStandard` provisions template plan | Plan intent, not exact engine version or result. |
| Standard communications | `webinar_standard_communications`: canonical key, sort, audience, timing, offset, direction, weekend adjustment, lock/status/content variants, nullable `communication_id`/`schedule_rule_id`, original/current/effective scheduled timestamps; per-session key/sort uniqueness | Strongest existing standard plan model; may outlive/unlink a Touch via `ON DELETE SET NULL` | No participant obligation identity or provider execution receipt. |
| Schedule rules | `schedule_rules`: offsets, direction, business-day strategy, audience-local timezone, timezone, target send time, enabled, `row_version` | Rule intent | No execution semantics. |
| Scheduled instances | `scheduled_instances`: `original_calculated_at`, `calculated_at`, nullable `adjusted_at`, reason, timezone, status, `row_version`; unique rule-instance relationship | Current schedule projection; original time immutable by trigger | There is no `instance_at` or `effective_at` column. `adjusted_at` is the manual effective override. |
| Schedule history | `scheduled_instance_history`: instance/rule/campaign, anchor, previous/current calculation, reason, created time | Recalculation history | No provider send/delivery history. |
| Registration confirmation trigger | `webinar_standard_trigger_events`: campaign/session/person/standard communication, recorded time; successful-trigger ledger | Append-only successful planning trigger; migration 0010 intentionally permits repeated valid transitions | Not a send receipt; no provider ID. |
| Current suppression | `evaluateWebinarPerson` computes `recruitmentSuppressed` from registration and rule; `recordRegistration` transitions and triggers confirmation planning | Local planning behavior after a registration row lock | No complete recipient selection, cancellation/waitlist/opt-out/invalid/internal/test/governed exclusion ledger, reason history, or provider boundary. |
| Communication change/cancel | Schedule recompute/history and audience evaluator types represent changes | Plans can be recomputed | No durable participant-facing change/cancellation execution observation. |
| Send/provider/background jobs | No worker, queue, cron, send endpoint, provider abstraction, webhook, delivery receipt, or external-send path was found under the inspected API application roots | Current repository responses/exports say `externalSending:false` or `externalPublishing:false` | Must remain absent in this phase and pilot. |

### 3.4 Deliverables, destinations, QA, governance, and measurement

| Category | Current implementation | Keys/consumers/tests | Gaps |
|---|---|---|---|
| Assets | `assets`: campaign, name, reusable, status, brief, owner, nullable `publish_by` | `lib/deliverables.ts`, delivery/export readiness, deliverables tests | No content-version snapshot or engine evidence scope. |
| Landing pages | `landing_pages`: campaign, name, nullable URL, status, content requirements, owner, nullable publish date | URL/status checks; export blocks missing/unpublished HTTP(S) destinations | Nullable URL remains a compatibility boundary. |
| CTAs | `ctas`: campaign, button text, exactly one landing-page or destination URL, owner/status/publish date, legacy key, metadata | `communication_ctas`; canonical CTA helpers | No universal deliverable type. |
| Resource joins | `communication_ctas`, `communication_landing_pages`, `landing_page_content_assets` with composite PKs and campaign-safe FKs | Delivery readiness | Four FKs have a temporary development publish exception in 0021; not a permanent optionality policy. |
| QA checklist | `communication_details`: approval status, five QA booleans, dependencies JSON, release state/time | `saveCommunicationDetails`; delivery UI/tests | Current mutable checklist only; no reviewer, per-check time, content version, immutable evidence, or provenance. |
| Taxonomy | `taxonomy_versions`, `taxonomy_terms`, categories, governed channels, imports/candidates, quarantine metadata | `lib/governance.ts`, governance routes/tests | Local/provisional representation; not a live Foundation observation or production authority. |
| Naming | Governed activity JSON plus `renderActivityName`; generated activity/session naming checks | Campaign and webinar routes; activity tests | No stored Foundation naming receipt/version. |
| Campaign code | Local taxonomy/governance values and UTM inputs | Campaign UTM route | No connected Foundation campaign-code receipt. |
| UTM | `utm_links` and `lib/utm-compiler.ts`; generated values, text taxonomy version, status/published time | `POST /campaigns/:id/utm-links`; UTM tests | Compiler explicitly returns provisional governance; taxonomy version text has no taxonomy-version FK. |
| Exceptions | In-memory validation/resolution modules | `test/exceptions/validate.test.ts`; exception-separation tests | No application table, route, authenticated review, or immutable decision history. |
| Readiness | In-memory classifiers/evaluators; campaign integer exists | readiness tests only | No authoritative persisted stage result or UI; campaign integer is not a substitute. |
| Measurement | Generic campaign KPIs and engine measurement contexts | Setup/completion evaluators | No occurrence-scoped obligation/actual/result snapshot. |
| Audit/history | `change_log`; `governance_audit_events`; approvals/comments; schedule history; trigger history | `insertAudit`; governance routes/tests | Generic polymorphic logs lack target FKs, idempotency, exact input/version binding, and guaranteed webinar write paths. |

### 3.5 Concrete subsystem link map

| Subsystem | Schema keys/FKs | Current service and route linkage | UI/test linkage and explicit absence |
|---|---|---|---|
| Campaign map | `campaigns.id`; activities require `campaign_id`; activity `(id,campaign_id)` unique supports scoped children | `routes/campaigns.ts`: `GET /campaigns`, `POST /campaigns`, `PATCH /campaigns/:id`, `PUT /campaigns/:id/map`, `POST /campaigns/:id/activities`; map update is transactional and checks `row_version` | `components/map/EngagementMap.tsx`; `test/activity-model.routes.test.ts` and campaign route coverage. No Journey service/table is linked. |
| Webinar session | `webinar_sessions.campaign_id → campaigns.id`, `activity_id → activities.id`, composite `webinar_sessions_activity_campaign_fk`, unique campaign/activity/name and `(id,campaign_id)` | `routes/webinars.ts`: `GET/POST /campaigns/:id/webinars`, `GET/PATCH /campaigns/:id/webinars/:sessionId`; `lib/webinar.ts` schemas/responses/evaluation; `lib/delivery.ts` anchor recompute | `WebinarSetupDialog.tsx`, `WebinarStandardPanel.tsx`; `test/webinar.test.ts`, `test/webinar-standard.routes.test.ts`. Setup dialog supplies `speakers: []`; it does not collect speakers interactively. |
| Synthetic people | campaign FK, audience FK plus `webinar_people_audience_campaign_fk`; unique campaign/name and `(id,campaign_id)` | `GET/POST /campaigns/:id/webinars/:sessionId/people`; `personResponse` and `evaluateWebinarPerson` in `lib/webinar.ts` | Standard panel reads people; webinar tests cover planning people. No service links these rows to CRM/contact identities. |
| Registration | session/person direct FKs plus composite campaign FKs; unique `(session_id,person_id)`; DB check `registered|not_registered` | `POST /campaigns/:id/webinars/:sessionId/people/:personId/registration`; `recordRegistration` row lock/upsert/first-registration/confirmation planning | Standard panel evaluation and `test/webinar.test.ts`. No cancellation or waitlist route/table/service link exists. |
| Attendance | session/person direct FKs plus composite campaign FKs; unique `(session_id,person_id)`; DB check `attended|no_show` | `POST /campaigns/:id/webinars/:sessionId/people/:personId/attendance`; `recordAttendance` upserts current projection | Evaluation UI consumes result; webinar and audience/follow-up tests cover modeled branches. No import/provider/reconciliation/history service is linked. |
| Old webinar evaluation | Reads session/person plus current registration/attendance; no result table | `GET .../:sessionId/evaluation` and `POST .../:sessionId/evaluate`; `evaluateWebinarPerson`/`evaluateWebinarSession` in `lib/webinar.ts` | Current route tests. This is the pre-Phase-2A branch planner, not the 106-rule evaluator registry and not certified WEB-STANDARD evaluation. |
| Standard plan | config unique session; communication rows unique session/key and session/sort; nullable communication/rule FKs | `GET/PATCH /campaigns/:id/webinars/:sessionId/standard`, `GET .../standard/eligibility`, `GET .../standard/export`; `ensureWebinarStandard`, `standardForSession`, trigger helpers under `src/lib/webinar-standard*` | `WebinarStandardPanel.tsx`; `test/webinar-standard.test.ts`, `test/webinar-standard.routes.test.ts`. Export is provisional and has no publishing service link. |
| Shared planning | schedule rules/instances/history with campaign-safe composite FKs and rule-instance uniqueness | `GET/POST /campaigns/:id/schedule-rules`, `PATCH/DELETE .../schedule-rules/:ruleId`, `GET .../scheduled-instances`, `POST .../schedule-rules/recompute`, `PATCH .../scheduled-instances/:instanceId/adjust`; `lib/planning.ts`; `recomputeWebinarDeliveryAnchor` in `lib/delivery.ts` | Scheduling/planning tests and Standard panel schedule display. No send worker consumes an instance in inspected code. |
| Delivery/Touch | communications require campaign/activity; `(id,campaign_id)` unique; details one-to-one; tasks linked to activity/campaign | `GET /campaigns/:id/delivery`, `POST /campaigns/:id/communications`, `PATCH/DELETE .../communications/:itemId`, `POST /campaigns/:id/tasks`, `PATCH .../tasks/:itemId`; `lib/delivery.ts` | Map/standard panel and `test/delivery.test.ts`. No provider receipt or recipient ledger service is linked. |
| Deliverable resources | assets/pages/CTAs campaign-scoped; join composite PKs; CTA XOR destination check; composite campaign FKs subject to documented 0021 staging exception | No separate REST resource service was identified; `lib/deliverables.ts` supplies readiness/canonical CTA checks used by delivery/export routes | Standard/delivery UI indirectly consumes readiness; `test/deliverables.routes.test.ts`. Assets/pages/CTAs are resources, not a generic deliverable or immutable content-version service. |
| Governance/taxonomy | taxonomy version/term/category hierarchy; channels; approvals/comments/audit/imports; `utm_links.taxonomy_version` is un-FKed text | `/governance/audit`, `/governance/terms` list/create/update/resolve/deprecate/rename, `/governance/imports` create/read/candidate-update/commit, `/governance/approvals` list/create/update, `/governance/comments` list/create/update; `lib/governance.ts`, `lib/governance-quarantine.ts`; campaign UTM route and `lib/utm-compiler.ts` | Governance/UTM tests. No live Foundation transport or trusted observation ingestion service is linked. |
| QA/evidence | communication details PK/FK to communication; generic polymorphic approvals/comments/audit have no typed webinar evidence FK | `saveCommunicationDetails` writes current QA/release values; engine evidence validators are pure modules | Delivery UI/tests and `test/evidence/*`. No application evidence CRUD route, content-version scope, or immutable evidence service is linked. |
| Exception/readiness/completion | No application tables or FKs | Pure modules under `src/lib/webinar-standard-exceptions`, `webinar-standard-readiness`, and `webinar-standard-evaluation`; no application route linkage | Tests under `test/exceptions`, `test/readiness`, and evaluation completion suites. No Campaign Workspace screen consumes the 106-rule reports. |
| Measurement | generic campaign KPI data; no occurrence result FK/snapshot | Setup/completion evaluator inputs only; no occurrence measurement route/service identified | No webinar measurement UI or result test against persistence was found. |

## 4. Approved hierarchy assessment

The approved model is:

```text
Campaign
  → optional Journey
    → Activity
      → Communication/Touch
        → Deliverable
```

The current concrete path is:

```text
campaigns
  → activities
    → webinar_sessions
    → communications
      → communication_ctas / communication_landing_pages
        → ctas / landing_pages / assets
```

A webinar remains an Activity.
`governedWebinarActivity()` enforces governed activity identity before webinar operations.
A webinar session is subordinate occurrence data, not a Journey.
No Journey model exists.
Neither `campaigns.parent_id`, activity connections, nor audience branches should be inferred to be Journey.
The missing optional Journey layer is a compatibility gap, not permission to introduce one during engine integration.
The resource-specific joins also mean the final Touch-to-Deliverable edge is not universal.

## 5. Field-level domain-to-application mapping

The classifications below concern source availability, not a proposed column for each
context property. Repeated identity fields reuse existing scoped IDs; snapshot IDs and
completeness flags belong to one immutable snapshot assembled from authoritative inputs,
not independent editable application facts. Runtime outputs remain recomputable.
“Missing and requiring persistence” may therefore mean a missing source fact or retained
evidence envelope, not a new table. Existing values are reused only where their semantics
match; adapters must return missing evidence rather than infer unsupported facts.

### 5.1 Root `EvaluationContext`

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed instant; include in an immutable audit snapshot only when a result is relied upon; never implicit wall clock. |
| `event.eventId` | already persisted | `webinar_sessions.id`. |
| `event.operationalStatus` | missing and requiring persistence | No authoritative session lifecycle source exists; never infer from registration or attendance. |
| `event.startsAtEpochMs` | derived from existing data | Temporal conversion of `session_date`, `start_time`, and `timezone`. |
| `participant.participantId` | already persisted | `webinar_people.id` is a local synthetic planning identity only; a real contact identity would require external linkage. |
| `participant.eventId` | already persisted | Registration/attendance `session_id`. |
| `participant.registrationStatus=not_registered|registered` | derived from existing data | Constrained registration `result`. |
| `participant.registrationStatus=waitlisted|cancelled` | missing and requiring persistence | No authoritative transition/state source exists. |
| `participant.attendanceState=attended|absent` | derived from existing data | Attendance `attended` maps to attended; `no_show` maps to absent. |
| `participant.attendanceState=unknown` | missing and requiring persistence | No unknown/reconciliation state or history exists. |
| `participant.audienceClass` | missing and requiring persistence | `is_synthetic` does not distinguish customer/internal/test. |
| `participant.includedInAttendance` | missing and requiring persistence | No exact current field; future projection requires explicit source facts and canonical inclusion rules. |
| `participant.includedInReporting` | missing and requiring persistence | No exact current field; exclusion/audience facts must be explicit. |
| `communications[].communicationId` | already persisted | `communications.id` or nullable `webinar_standard_communications.communication_id`. |
| `communications[].eventId` | derived from existing data | Resolve through the communication Activity and scoped session; adapter must reject ambiguous/mismatched scope. |
| `communications[].recipientIds[]` | missing and requiring persistence | No recipient-level obligation or execution ledger. |
| `communications[].kind` | derived from existing data | Explicit canonical mapping from standard key/audience and communication type. |
| `communications[].variant=attended|absent|null` | derived from existing data | Standard variant/configuration rows and communication identity. |
| `communications[].variant=neutral` | missing and requiring persistence | No approved, versioned neutral variant identity exists. |
| `communications[].state=planned|omitted` | derived from existing data | Standard/schedule disposition only; planning state is not execution. |
| `communications[].state=recorded` | missing and requiring persistence | Requires an actual scoped operational observation. |
| `communications[].createdAtEpochMs` | already persisted | Communication/standard row creation timestamps where the mapped row exists. |
| `communications[].scheduledAtEpochMs` | already persisted | Standard `effective_scheduled_at` or schedule projection; still planning only. |
| `communications[].recordedAtEpochMs` | available only through external integration | No inspected provider/execution receipt path supplies it. |
| `communications[].utmRequired` | derived from existing data | Canonical policy over communication/destination configuration. |
| `communications[].utm` | available only through external integration | Foundation-governed receipt required; local `utm_links` is provisional compatibility data. |
| `registrationFlowTest.confirmed` | missing and requiring persistence | Existing QA booleans are not this typed, scoped confirmation. |
| `registrationFlowTest.evidence` | missing and requiring persistence | No immutable evidence reference/content scope. |
| `joinLinkOrVenueTest.confirmed` | missing and requiring persistence | No exact typed confirmation. |
| `joinLinkOrVenueTest.evidence` | missing and requiring persistence | No immutable evidence reference/content scope. |
| `consent.required` | missing and requiring persistence | No exact authoritative field; do not infer a default from activity JSON. |
| `consent.languageAttached` | missing and requiring persistence | No exact complete consent-language source. |
| `consent.confirmation.confirmed` | missing and requiring persistence | No typed scoped confirmation. |
| `consent.confirmation.evidence` | missing and requiring persistence | No immutable evidence reference. |
| `governance.internalName` | available only through external integration | Requires a Foundation-governed observation; local generated name is not authority. |
| `governance.campaignCode` | available only through external integration | No connected Foundation campaign-code receipt. |
| `governance.taxonomyValues[]` | available only through external integration | Local taxonomy rows are provisional compatibility data. |
| `followUp.attended.variantId` | derived from existing data | Standard communication/variant identity. |
| `followUp.attended.messageContent` | already persisted | Current standard variant content, subject to missing immutable content version. |
| `followUp.attended.destinationId` | derived from existing data | CTA/landing-page association through communication joins. |
| `followUp.absent.variantId` | derived from existing data | Template-specific standard communication/variant identity where configured. |
| `followUp.absent.messageContent` | already persisted | Current configured content where present, subject to missing immutable content version. |
| `followUp.absent.destinationId` | derived from existing data | CTA/landing-page association through communication joins. |
| `followUp.distinctContentConfirmation.confirmed` | missing and requiring persistence | Artifact existence is insufficient. |
| `followUp.distinctContentConfirmation.evidence` | missing and requiring persistence | No immutable reviewer/content-version evidence. |

### 5.2 Setup, measurement, and finding evidence

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `setup.eventId` | already persisted | `webinar_sessions.id`, bound to Activity. |
| `setup.snapshotId` | missing and requiring persistence | No immutable setup snapshot identity. |
| `setup.complete` | missing and requiring persistence | No typed setup completeness record. |
| `setup.activityType` | derived from existing data | Map governed `activities.activity_type_id` to the catalog's activity-type vocabulary; do not add a duplicate type field. |
| `setup.evaluationStage` | missing but intentionally runtime-only | Requested evaluation stage/trigger supplied by orchestration, not the result of readiness calculation or a manually asserted ready state. |
| `setup.title` | already persisted | Governed Activity/session name candidate; adapter must preserve identity boundary. |
| `setup.topic` | missing and requiring persistence | No exact inspected schema field is established as canonical topic. |
| `setup.description` | missing and requiring persistence | No exact inspected webinar setup field. |
| `setup.intendedAudience` | derived from existing data | Activity/campaign audience references, with explicit adapter mapping. |
| `setup.eventLocalDate` | already persisted | `webinar_sessions.session_date`. |
| `setup.localStartTime` | already persisted | `webinar_sessions.start_time`. |
| `setup.durationMinutes` | already persisted | `webinar_sessions.duration_minutes`. |
| `setup.timeZone` | already persisted | `webinar_sessions.timezone`. |
| `setup.format` | missing and requiring persistence | No universal exact setup field; do not assume `platform` is format. |
| `setup.platform` | already persisted | `webinar_sessions.platform`. |
| `setup.physicalLocation` | missing and requiring persistence | No exact session field. |
| `setup.registrationDestination` | derived from existing data | CTA/landing-page association only when adapter resolves one authoritative role. |
| `setup.owner` | already persisted | Activity owner. |
| `setup.recruitmentOwner` | derived from existing data | Communication/task owner only through an explicit role mapping. |
| `setup.followUpOwner` | derived from existing data | Communication/task owner only through an explicit role mapping. |
| `setup.primaryCta` | derived from existing data | CTA join plus explicit role mapping. |
| `setup.followUpCta` | derived from existing data | Follow-up communication CTA join plus explicit role mapping. |
| `setup.measurementTargets[]` | missing and requiring persistence | Generic KPI/config may be adapter input, but no exact occurrence-scoped target snapshot exists. |
| `setup.registrationOpeningRule` | missing and requiring persistence | `registration_rule` contains suppression/branch keys, not opening-rule data. |
| `setup.registrationClosingRule` | missing and requiring persistence | `registration_rule` contains suppression/branch keys, not closing-rule data. |
| `setup.platformEnforcesCapacity` | missing and requiring persistence | No exact field/evidence source. |
| `setup.capacity` | missing and requiring persistence | No exact webinar session field. |
| `setup.audienceNonDefaultLanguage` | missing and requiring persistence | No exact source; evaluator may not invent a default. |
| `setup.language` | missing and requiring persistence | No exact source. |
| `measurementPlan.eventId` | already persisted | Session/event identity. |
| `measurementPlan.snapshotId` | missing and requiring persistence | No typed occurrence measurement snapshot. |
| `measurementPlan.complete` | missing and requiring persistence | No authoritative completeness record. |
| `measurementPlan.description` | missing and requiring persistence | Generic campaign KPI text is not an exact occurrence measurement-plan description. |
| `measurementPlan.targets[].targetId` | missing and requiring persistence | No occurrence-scoped typed target identity. |
| `measurementPlan.targets[].metric` | missing and requiring persistence | Generic KPIs are not an exact mapped source until an adapter contract exists. |
| `measurementPlan.targets[].target` | missing and requiring persistence | No exact occurrence-scoped numeric target. |
| `measurementPlan.targets[].unit` | missing and requiring persistence | No exact occurrence-scoped unit. |
| `findingEvidence.standardId` | missing but intentionally runtime-only | Orchestrator binds canonical `WEB-STANDARD-001`; persist only within a relied-upon audit snapshot. |
| `findingEvidence.standardVersion` | missing but intentionally runtime-only | Orchestrator binds `1.0-pilot-rc1`; session template is not this value. |
| `findingEvidence.eventId` | derived from existing data | Bound from session identity into request-local evidence context. |
| `findingEvidence.snapshotId` | missing and requiring persistence | Immutable evidence snapshot identity is absent. |
| `findingEvidence.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed observation time. |
| `findingEvidence.complete` | missing and requiring persistence | No evidence-snapshot completeness authority. |
| `findingEvidence.setupResults[]` | missing but intentionally runtime-only | Exact prior `RuleEvaluationResult` envelopes supplied by orchestration. |
| `findingEvidence.ownerResults[]` | missing but intentionally runtime-only | Exact prior `RuleEvaluationResult` envelopes supplied by orchestration. |

### 5.3 Scheduling and audience contexts

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `scheduling.evaluationStage` | missing but intentionally runtime-only | Requested evaluation stage/trigger; independent of the readiness result being calculated. |
| `scheduling.occurrenceId` | already persisted | `webinar_sessions.id`. |
| `scheduling.timeZone` | already persisted | `webinar_sessions.timezone`. |
| `scheduling.recruitmentPlan.planningOnly` / `.sendAuthorized` / `.authority.readinessOverride` / `.authority.exceptionOverride` / `.authority.suppressionOverride` | available from an existing service | Canonical planner hard-codes the non-authoritative planning boundary. |
| `scheduling.recruitmentPlan.standardId` / `.standardVersion` | available from an existing service | Validated catalog-bound planner output. |
| `scheduling.recruitmentPlan.selectedBand` / `.localCalendarDaysRemaining` | available from an existing service | Canonical shortened-window calculation. |
| `scheduling.recruitmentPlan.calculationInstantEpochMs` / `.webinarStartEpochMs` / `.timeZone` / `.eventStatus` | available from an existing service | Canonical planner echoes validated planning inputs. |
| `scheduling.recruitmentPlan.touches[].identity` / `.communicationId` / `.disposition` / `.scheduledAtEpochMs` | available from an existing service | Canonical planned touch output. |
| `scheduling.recruitmentPlan.touches[].eventLocalDate` / `.eventLocalTime` / `.eventLocalOffset` / `.originalOffsetDays` | available from an existing service | Canonical timezone/cadence output. |
| `scheduling.recruitmentPlan.touches[].reason` / `.warnings[]` / `.ruleIds[]` | available from an existing service | Canonical explanatory output. |
| `scheduling.recruitmentPlan.touches[].timeAdjustment.disambiguation` / `.requestedLocalDateTime` | available from an existing service | Canonical DST adjustment output. |
| `scheduling.recruitmentPlan.warnings[]` / `.ruleIds[]` | available from an existing service | Canonical plan-level findings. |
| `scheduling.configuredPlan.snapshotId` | missing and requiring persistence | No immutable configuration snapshot identity. |
| `scheduling.configuredPlan.occurrenceId` | already persisted | Session identity. |
| `scheduling.configuredPlan.eventId` | already persisted | Session identity used as event in current adapter design. |
| `scheduling.configuredPlan.standardId` | missing but intentionally runtime-only | Bound from validated catalog. |
| `scheduling.configuredPlan.standardVersion` | missing but intentionally runtime-only | Bound from validated catalog, not `template_version`. |
| `scheduling.configuredPlan.complete` | missing and requiring persistence | No configuration completeness record. |
| `scheduling.configuredPlan.touches[].identity` | derived from existing data | Canonical mapping from standard communication key. |
| `scheduling.configuredPlan.touches[].communicationId` | already persisted | Linked communication/standard row identity. |
| `scheduling.configuredPlan.touches[].disposition` | derived from existing data | Standard row status and canonical planner mapping. |
| `scheduling.configuredPlan.touches[].scheduledAtEpochMs` | already persisted | Standard effective schedule or schedule projection. |
| `scheduling.configuredPlan.surfacedWarnings[]` | missing but intentionally runtime-only | Canonical planner warnings. |
| `scheduling.creationSnapshot.snapshotId` | missing and requiring persistence | No immutable occurrence-scoped creation basis. |
| `scheduling.creationSnapshot.occurrenceId` / `.eventId` | derived from existing data | Session identity. |
| `scheduling.creationSnapshot.standardId` / `.standardVersion` | missing and requiring persistence | Exact standard binding absent from an immutable creation snapshot. |
| `scheduling.creationSnapshot.capturedAtEpochMs` | missing and requiring persistence | No creation-snapshot capture time. |
| `scheduling.creationSnapshot.timeZone` | already persisted | Session timezone, but historical snapshot is absent. |
| `scheduling.creationSnapshot.eventStatus` | missing and requiring persistence | No event lifecycle source. |
| `scheduling.creationSnapshot.recruitmentPlan` | available from an existing service | Canonical plan exists at runtime; immutable original copy is absent. |
| `scheduling.creationSnapshot.configuredPlan` | missing and requiring persistence | Immutable nested configured snapshot absent. |
| `scheduling.suppression.snapshotId` | missing and requiring persistence | No suppression snapshot. |
| `scheduling.suppression.occurrenceId` / `.eventId` | derived from existing data | Session identity. |
| `scheduling.suppression.standardId` / `.standardVersion` | missing and requiring persistence | Exact snapshot binding absent. |
| `scheduling.suppression.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed observation time. |
| `scheduling.suppression.completePopulation` | missing and requiring persistence | No complete scoped recipient population. |
| `scheduling.suppression.recruitmentCommunicationIds[]` | derived from existing data | Standard recruitment communication rows. |
| `scheduling.suppression.audiencePlan` | available from an existing service | Canonical audience planner output. |
| `scheduling.suppression.observations[].ruleId` | derived from existing data | Canonical suppression rule selected by orchestrator. |
| `scheduling.suppression.observations[].participantId` | already persisted | Local synthetic person ID only. |
| `scheduling.suppression.observations[].evidence` | missing and requiring persistence | No immutable typed observation evidence. |
| `scheduling.suppression.observations[].conditionApplies` | derived from existing data | Canonical evaluation over authoritative facts, once those facts exist. |
| `scheduling.suppression.observations[].cancellationAtEpochMs` | missing and requiring persistence | No cancellation transition source. |
| `scheduling.suppression.observations[].recipientObservations[].communicationId` / `.scheduledAtEpochMs` / `.included` | missing and requiring persistence | No participant/communication inclusion ledger. |
| `scheduling.suppression.controls[].ruleId` / `.active` | derived from existing data | Canonical control evaluation. |
| `scheduling.suppression.controls[].evidence` | missing and requiring persistence | No typed control evidence. |
| `scheduling.suppression.prerequisiteResults[]` | missing but intentionally runtime-only | Exact prior registry outputs. |
| `scheduling.omissionDisplay.evidence` | missing and requiring persistence | No reviewed render evidence. |
| `scheduling.omissionDisplay.occurrenceId` | already persisted | Session identity. |
| `scheduling.omissionDisplay.configuredSnapshotId` | missing and requiring persistence | Configuration snapshot absent. |
| `scheduling.omissionDisplay.renderVersion` | missing and requiring persistence | No durable render version. |
| `scheduling.omissionDisplay.entries[].identity` / `.communicationId` / `.label` / `.reason` | missing but intentionally runtime-only | Derived rendered omission projection; persist only when audit-relevant with evidence. |
| `audience.occurrenceId` | already persisted | Session identity. |
| `audience.input.calculationInstantEpochMs` | missing but intentionally runtime-only | Caller-fixed planning instant. |
| `audience.input.timeZone` | already persisted | Session timezone. |
| `audience.input.standardId` / `.standardVersion` | missing but intentionally runtime-only | Validated catalog binding. |
| `audience.input.event.eventId` | already persisted | Session identity. |
| `audience.input.event.operationalStatus` | missing and requiring persistence | No authoritative lifecycle source. |
| `audience.input.event.startsAtEpochMs` | derived from existing data | Session local date/time/timezone conversion. |
| `audience.input.event.endsAtEpochMs` | derived from existing data | Planned start plus `duration_minutes`; not actual end. |
| `audience.input.event.actualEndsAtEpochMs` | missing and requiring persistence | No operational actual-end fact. |
| `audience.input.event.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed observation instant. |
| `audience.input.event.materialChangeTriggeredAtEpochMs` | missing and requiring persistence | No participant-facing change transition source. |
| `audience.input.event.cancellationTriggeredAtEpochMs` | missing and requiring persistence | No event cancellation transition source. |
| `audience.input.recruitmentTouches[].identity` | derived from existing data | Canonical mapping from standard recruitment keys. |
| `audience.input.recruitmentTouches[].communicationId` | already persisted | Communication/standard link. |
| `audience.input.participants[].participantId` / `.eventId` | already persisted | Person/session identities. |
| `audience.input.participants[].registrationStatus=not_registered|registered` | derived from existing data | Current registration projection. |
| `audience.input.participants[].registrationStatus=waitlisted|cancelled` | missing and requiring persistence | Transition facts absent. |
| `audience.input.participants[].attendanceState=attended|absent` | derived from existing data | Current attendance projection. |
| `audience.input.participants[].attendanceState=unknown` | missing and requiring persistence | Unknown/reconciliation source absent. |
| `audience.input.participants[].audienceClass` | missing and requiring persistence | Distinct from root participant field but has the same absent customer/internal/test authority. |
| `audience.input.participants[].recruitmentEligible` / `.contactable` | missing and requiring persistence | No complete recipient eligibility/contactability source. |
| `audience.input.participants[].optedOut` / `.invalidAddress` | available only through external integration | No local contact system stores these facts. |
| `audience.input.participants[].governedExclusion` | available only through external integration | Foundation observation, never local policy calculation. |
| `audience.input.participants[].registrationAtEpochMs` | already persisted | `first_registered_at` when registered. |
| `audience.input.participants[].attendanceAvailableAtEpochMs` | already persisted | Attendance `recorded_at`, while provenance/history remain absent. |
| `audience.input.participants[].waitlistedAtEpochMs` / `.waitlistPromotionTriggeredAtEpochMs` / `.waitlistClosureTriggeredAtEpochMs` | missing and requiring persistence | No waitlist transitions. |
| `audience.input.participants[].participantCancellationTriggeredAtEpochMs` | missing and requiring persistence | No cancellation transition. |
| `audience.input.participants[].neutralVariantApproved` | unresolved product decision | Exact neutral content/version and approval authority remain unresolved. |
| `audience.input.participants[].qaTestSendRequested` | missing and requiring persistence | No participant-scoped QA request fact. |
| `audience.input.participants[].followUpAssetId` | derived from existing data | Communication/resource joins when an explicit follow-up role is mapped. |
| `audience.input.participants[].communicationIds` | derived from existing data | Canonical kind-to-communication mapping. |
| `audience.plan.mode` / `.sendAuthorized` | available from an existing service | Canonical planner returns `planning_only` and `false`. |
| `audience.plan.standardId` / `.standardVersion` / `.eventId` / `.calculationInstantEpochMs` / `.timeZone` | available from an existing service | Canonical planner output bound to validated input. |
| `audience.plan.authority.readinessOverride` / `.exceptionOverride` / `.sendingAuthority` | available from an existing service | Canonical non-authority flags, all false. |
| `audience.plan.businessDayConvention.days` / `.holidayCalendar` / `.timeZone` / `.limitation` | available from an existing service | Canonical planner's explicit convention/limitation. |
| `audience.plan.participants[].participantId` / `.state` / `.recruitmentEligible` / `.customerReportingIncluded` | available from an existing service | Canonical participant projection from input facts. |
| `audience.plan.participants[].suppressions[]` / `.warnings[]` | available from an existing service | Canonical explanatory projection. |
| `audience.plan.participants[].obligations[].kind` / `.communicationId` / `.disposition` / `.timingKind` / `.dueAtEpochMs` / `.overdue` | available from an existing service | Canonical obligation plan, never send authorization. |
| `audience.plan.participants[].obligations[].reason` / `.customerPath` / `.variant` / `.assetId` / `.canonicalRuleIds[]` | available from an existing service | Canonical obligation explanation/identity. |
| `audience.plan.participants[].obligations[].deadlineLocal.date` / `.time` / `.offset` / `.disambiguation` / `.requestedLocalDateTime` | available from an existing service | Canonical local deadline rendering data when present. |
| `audience.plan.participants[].recruitmentPlan` | available from an existing service | Nested canonical recruitment planner output or null. |
| `audience.registrationBasis` | missing and requiring persistence | Immutable registration-time input/plan absent. |
| `audience.evaluationStage` | missing but intentionally runtime-only | Requested evaluation stage/trigger, not calculated readiness or an editable ready state. |
| `audience.operational.snapshotId` / `.complete` / `.evidence` | missing and requiring persistence | No complete actual recipient ledger snapshot. |
| `audience.operational.occurrenceId` / `.participantId` | derived from existing data | Session/person identity. |
| `audience.operational.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed snapshot time. |
| `audience.operational.ruleId` | derived from existing data | Canonical orchestrated rule identity. |
| `audience.operational.communications[].communicationId` / `.kind` | derived from existing data | Plan identity; does not establish operation. |
| `audience.operational.communications[].customerPath` / `.outcome` / `.atEpochMs` / `.triggerAtEpochMs` | missing and requiring persistence | Actual recipient operation absent. |
| `audience.operational.communications[].calendarIncluded` / `.attendanceInformationIncluded` | missing and requiring persistence | Actual rendered observation absent. |
| `audience.operational.communications[].renderedTimes[]` / `.renderVersion` / `.renderedEvidence` | missing and requiring persistence | No immutable rendered artifact observation. |
| `audience.operational.communications[].cancellationPermission` | missing and requiring persistence | No explicitly reviewed permission evidence. |
| `audience.operational.materialChanges[].field` / `.participantFacingPublished` / `.changedAtEpochMs` | missing and requiring persistence | No immutable material-change history. |
| `audience.operational.recipientHistory[].fromEpochMs` / `.throughEpochMs` | missing and requiring persistence | No reviewed recipient-state interval history. |
| `audience.operational.recipientHistory[].registrationStatus` / `.audienceClass` / `.eventStatus` | missing and requiring persistence | Current projections cannot reconstruct interval state. |
| `audience.configuration.snapshotId` / `.complete` / `.evidence` | missing and requiring persistence | No immutable configuration evidence snapshot. |
| `audience.configuration.occurrenceId` | already persisted | Session identity. |
| `audience.configuration.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed configuration observation time. |
| `audience.configuration.entries[].kind` / `.communicationId` / `.disposition` / `.immediate` / `.nominalAtEpochMs` | derived from existing data | Standard rows and canonical configuration mapping. |
| `audience.configuration.prerequisiteResults[]` | missing but intentionally runtime-only | Exact prior registry outputs. |

### 5.4 Deliverable and governed contexts

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `deliverables.standardId` / `.standardVersion` | available from an existing service | Validated catalog supplies `WEB-STANDARD-001` / `1.0-pilot-rc1`; session template is not equivalent. |
| `deliverables.eventId` / `.occurrenceId` | derived from existing data | Session/activity/resource joins with campaign-scope checks. |
| `deliverables.snapshotVersion` / `.snapshotCreatedAtEpochMs` / `.complete` | missing and requiring persistence | No immutable content-inventory snapshot. |
| `deliverables.activityType` | already persisted | `activities.activity_type_id`. |
| `deliverables.evaluationStage` | missing but intentionally runtime-only | Requested evaluation stage/trigger, not calculated readiness or an editable ready state. |
| `deliverables.communications[].communicationId` | already persisted | Communication/standard link. |
| `deliverables.communications[].eventId` / `.occurrenceId` | derived from existing data | Resolve through scoped Activity/session relationship. |
| `deliverables.communications[].kind` / `.channel` / `.variant` / `.audienceState` | derived from existing data | Explicit canonical mapping from standard rows, governed channel, variant, and participant facts. |
| `deliverables.artifacts[].deliverableId` | derived from existing data | Stable adapter identity over asset/page/CTA resource; no generic table exists. |
| `deliverables.artifacts[].role` | derived from existing data | Explicit technical role mapping from resource/communication use; no role may be guessed from existence alone. |
| `deliverables.artifacts[].eventId` / `.occurrenceId` | derived from existing data | Campaign/communication/session scope. |
| `deliverables.artifacts[].contentVersion` / `.versionCreatedAtEpochMs` | missing and requiring persistence | Current content columns have no immutable version. |
| `deliverables.artifacts[].lifecycle` | derived from existing data | Resource status mapped to planned/produced by documented adapter. |
| `deliverables.artifacts[].communicationId` / `.assetId` / `.destinationId` | already persisted | Resource identities and join rows. |
| `deliverables.artifacts[].content` | already persisted | Current asset/page/CTA/variant content; snapshot gap remains. |
| `deliverables.artifacts[].owner` / `.dueAtEpochMs` | derived from existing data | Resource owner and `publish_by` where applicable. |
| `deliverables.artifacts[].speakerConfirmed` | missing and requiring persistence | Speaker JSON presence is not confirmation. |
| `deliverables.artifacts[].reviews[].ruleId` / `.kind` / `.evidence` | missing and requiring persistence | QA booleans/approvals lack typed reviewer/time/content-version scope. |
| `deliverables.prerequisites[].result` | missing but intentionally runtime-only | Exact prior canonical result envelope. |
| `deliverables.prerequisites[].evidence` | missing and requiring persistence | Typed scoped evidence absent. |
| `deliverables.supportingContentInventoryEvidence` | missing and requiring persistence | Inventory is queryable; reviewed completeness evidence is absent. |
| `deliverables.facts.capacitySet` / `.capacityReachable` | missing and requiring persistence | No exact capacity/evidence fields. |
| `deliverables.facts.objectiveCallsForHandraiser` / `.absentHandraiserAppropriate` | available only through external integration | Depend on governed objective plus scoped evidence. |
| `deliverables.facts.supportingChannelsUsed` | derived from existing data | Governed channel assignments where present; completeness evidence remains separate. |
| `deliverables.facts.accessibilityRequired` / `.salesAdjacent` | missing and requiring persistence | No exact authoritative webinar facts. |
| `deliverables.facts.waitlistInUse` | missing and requiring persistence | No waitlist source facts. |
| `deliverables.facts.qaSendRequested` | missing and requiring persistence | No exact participant/occurrence request field. |
| `deliverables.facts.recordingAvailability` / `.captureInUse` | missing and requiring persistence | No exact operational setup/evidence fields. |
| `governed.environment` | available only through external integration | Foundation observation environment; local manual values cannot authenticate it. |
| `governed.objective.request.eventId` / `.campaignId` | derived from existing data | Local identities placed into external request. |
| `governed.objective.request.inputFingerprint` / `.inputVersion` / `.requestReference` | available only through external integration | Connector request contract and durable request record are absent. |
| `governed.objective.request.expectedSourceVersion.version` / `.effectiveFromEpochMs` / `.effectiveThroughEpochMs` / `.deprecated` | available only through external integration | Foundation-owned version expectation. |
| `governed.objective.objectiveId` | derived from existing data | Local selected objective is request input, not proof of governed membership. |
| `governed.objective.observations[]` | available only through external integration | Foundation receipt; no local observation table/live connector. |
| `governed.exclusion.request.eventId` / `.campaignId` | derived from existing data | Local identities placed into the external request. |
| `governed.exclusion.request.inputFingerprint` / `.inputVersion` / `.requestReference` | available only through external integration | Connector request contract and durable request record are absent. |
| `governed.exclusion.request.expectedSourceVersion.version` / `.effectiveFromEpochMs` / `.effectiveThroughEpochMs` / `.deprecated` | available only through external integration | Foundation-owned version expectation. |
| `governed.exclusion.occurrenceId` | already persisted | Session identity. |
| `governed.exclusion.completePopulation` | missing and requiring persistence | No complete scoped recipient-population snapshot. |
| `governed.exclusion.audienceInput` | derived from existing data | Canonical local input assembled for the Foundation-bound evaluation. |
| `governed.exclusion.audiencePlan` | available from an existing service | Canonical audience planner output. |
| `governed.exclusion.observations[]` | available only through external integration | Foundation exclusion receipts. |
| `governed.exclusion.operational[].participantId` | already persisted | Local synthetic person identity only. |
| `governed.exclusion.operational[].evidence` | missing and requiring persistence | No actual scoped recipient evidence ledger. |
| `governed.exclusion.operational[].recipientObservations[].communicationId` / `.scheduledAtEpochMs` / `.included` | missing and requiring persistence | No actual scoped participant/communication observation ledger. |
| `GovernedObservation.observationId` / `.ruleId` / `.standardId` / `.standardVersion` | available only through external integration | Validated Foundation receipt identity and canonical scope. |
| `GovernedObservation.source` / `.capability` / `.sourceVersion` | available only through external integration | Foundation provenance/version. |
| `GovernedObservation.eventId` / `.campaignId` / `.participantId` / `.objectiveId` | available only through external integration | Receipt-bound subject references. |
| `GovernedObservation.inputFingerprint` / `.inputVersion` / `.requestReference` / `.outputReference` / `.outputType` | available only through external integration | Exact request/output correlation. |
| `GovernedObservation.status` / `.decision` / `.unavailableReason` / `.notes` | available only through external integration | Explicit success/unavailable/error result; never locally substituted. |
| `GovernedObservation.generatedAtEpochMs` / `.recordedAtEpochMs` / `.validFromEpochMs` / `.expiresAtEpochMs` | available only through external integration | Receipt timing/validity. |
| `GovernedObservation.provenance` / `.environment` | available only through external integration | Validated source evidence and production/test scope. |

### 5.5 Completion contexts

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `completionFollowUp.standardId` / `.standardVersion` | missing but intentionally runtime-only | Validated catalog binding; persist within asserted completion snapshot. |
| `completionFollowUp.eventId` / `.occurrenceId` | derived from existing data | Session identity. |
| `completionFollowUp.snapshotId` | missing and requiring persistence | No immutable follow-up snapshot. |
| `completionFollowUp.observedAtEpochMs` | missing but intentionally runtime-only | Caller-fixed observation instant. |
| `completionFollowUp.timeZone` | already persisted | Session timezone. |
| `completionFollowUp.actualEventEndAtEpochMs` | missing and requiring persistence | Planned end is not actual end. |
| `completionFollowUp.participantId` | already persisted | Local person identity. |
| `completionFollowUp.attendanceState=attended|absent` | derived from existing data | Current attendance projection. |
| `completionFollowUp.attendanceState=unknown` | missing and requiring persistence | Unknown/reconciliation source absent. |
| `completionFollowUp.plannedFollowUp.variant` / `.dueAtEpochMs` / `.communicationId` | derived from existing data | Standard communication and schedule plan; not execution evidence. |
| `completionFollowUp.sends[].communicationId` / `.participantId` / `.variant` | derived from existing data | Planned identities can be assembled; observation is not thereby proven. |
| `completionFollowUp.sends[].state` / `.atEpochMs` / `.evidenceId` | missing and requiring persistence | No actual follow-up operation/evidence ledger in inspected repository. |
| `completionFollowUp.reconciliation.participantId` / `.attendanceState` / `.reconciledAtEpochMs` / `.evidenceId` | missing and requiring persistence | No reconciliation history/evidence. |
| `completionFollowUp.neutralVariantApproved` | unresolved product decision | Exact neutral content/version and authenticated approval authority remain open. |
| `completionFollowUp.evidence[]` | missing and requiring persistence | No scoped immutable approval/reconciliation evidence IDs. |
| `completionStage.standardId` / `.standardVersion` | missing but intentionally runtime-only | Exact catalog scope supplied by orchestration. |
| `completionStage.eventId` / `.occurrenceId` | derived from existing data | Session identity. |
| `completionStage.snapshotId` / `.complete` | missing and requiring persistence | No immutable complete stage snapshot. |
| `completionStage.unknownFollowUpResults[]` / `.followUpResults[]` / `.results[]` | missing but intentionally runtime-only | Exact prior canonical `RuleEvaluationResult` envelopes. |
| `completionStage.findingEvidence.unknownFollowUpResults[]` / `.followUpResults[]` / `.sourceFindings[]` | missing but intentionally runtime-only | Request-local exact prior results. |
| `completionStage.findingEvidence.exceptions[]` / `.usedExceptionIds[]` | missing and requiring persistence | Durable exception snapshot/history absent. |
| `completionStage.plannerEvidence.audience` | missing but intentionally runtime-only | Typed as `unknown`; must carry canonical planner evidence, never a duplicate policy engine. |
| `completionStage.audience.complete` / `.eventId` / `.occurrenceId` / `.participantIds[]` / `.participants[].participantId` / `.participants[].attendanceState` | missing and requiring persistence | Complete occurrence-scoped audience/attendance snapshot absent. |
| `completionStage.exceptions[]` | missing and requiring persistence | In-memory exception shape exists; no application store. |
| `completionStage.exceptionClaims[].ruleId` / `.exceptionId` | missing and requiring persistence | No durable explicit resolution claims. |
| `completionStage.exceptionProvenance[].exceptionId` / `.ruleId` / `.eventId` / `.occurrenceId` | missing and requiring persistence | No occurrence-bound provenance history. |
| `completionStage.exceptionProvenance[].originalFindingId` / `.originalStatus` / `.originalStandardId` / `.originalStandardVersion` | missing and requiring persistence | No immutable original-finding binding. |
| `completionStage.usedExceptionIds[]` | missing and requiring persistence | No immutable used-exception snapshot. |
| `completionStage.sourceFindings[]` | missing but intentionally runtime-only | Prior canonical result envelopes. |
| `completionStage.measurementActuals[].targetId` / `.value` / `.unit` | missing and requiring persistence | No occurrence-scoped measurement actual source. |
| `completionStage.measurementActuals[].eventId` / `.occurrenceId` / `.snapshotId` / `.observedAtEpochMs` | missing and requiring persistence | No immutable actual snapshot/scope. |
| `completionSnapshot.standardId` / `.standardVersion` | missing and requiring persistence | Exact asserted-completion binding absent. |
| `completionSnapshot.eventId` / `.occurrenceId` | derived from existing data | Session identity, but immutable snapshot absent. |
| `completionSnapshot.calculatedAtEpochMs` | missing and requiring persistence | Must store caller-fixed calculation time for asserted completion. |
| `completionSnapshot.registryFingerprint` | missing and requiring persistence | Current runtime helper covers only ordered catalog IDs; stronger engine release binding is required before API exposure. |
| `completionSnapshot.exceptionSnapshotId` | missing and requiring persistence | No exception snapshot identity. |
| `completionSnapshot.canonicalRuleIds[]` | missing but intentionally runtime-only | Validated registry/catalog IDs. |
| `completionSnapshot.results[]` | missing and requiring persistence | Immutable completion finding envelopes absent. |
| `completionSnapshot.exceptions[]` / `.exceptionClaims[]` | missing and requiring persistence | No exception store/snapshot. |
| `completionSnapshot.evidenceSnapshot.snapshotId` / `.snapshotCompleteness` | missing and requiring persistence | No immutable evidence snapshot. |
| `completionSnapshot.evidenceSnapshot.eventId` / `.occurrenceId` / `.calculatedAtEpochMs` / `.registryFingerprint` | missing and requiring persistence | Exact evidence-snapshot scope/version binding absent. |
| `completionSnapshot.operationalObligations.attendanceReconciliation` | missing and requiring persistence | No authoritative obligation state snapshot. |
| `completionSnapshot.operationalObligations.requiredFollowUpCompletion` | missing and requiring persistence | No authoritative obligation state snapshot. |
| `completionSnapshot.operationalObligations.exceptionRecording` | missing and requiring persistence | No authoritative obligation state snapshot. |
| `completionSnapshot.operationalObligations.measurementCapture` | missing and requiring persistence | No authoritative obligation state snapshot. |
| `CompletionFindingEnvelope.result` | missing but intentionally runtime-only | Canonical descriptive result; persist envelope when completion is asserted. |
| `CompletionFindingEnvelope.eventId` / `.occurrenceId` / `.calculatedAtEpochMs` | missing and requiring persistence | Immutable result-scope binding absent. |
| `CompletionFindingEnvelope.snapshotFingerprint` / `.evidenceSnapshotId` / `.exceptionSnapshotId` | missing and requiring persistence | Immutable input/evidence/exception binding absent. |

### 5.6 Readiness, result, and exception fields

| Full context path | Classification | Confirmed source or explicit gap |
|---|---|---|
| `ManualEvidence.evidenceId` / `.ruleId` / `.standardId` / `.standardVersion` | missing and requiring persistence | In-memory evidence type/validator only; no application evidence record. |
| `ManualEvidence.evidenceStatus` / `.evidenceDescription` | missing and requiring persistence | No typed immutable finding evidence state. |
| `ManualEvidence.suppliedBy.nameOrPilotIdentifier` / `.suppliedBy.identityVerified` | missing and requiring persistence | Current engine deliberately records unverified identity; private-pilot auth must bind real subject provenance without falsifying this field. |
| `ManualEvidence.suppliedAtEpochMs` / `.sourceReference` / `.attachmentReference` | missing and requiring persistence | No typed source/attachment record. |
| `ManualEvidence.validFromEpochMs` / `.expiresAtEpochMs` / `.notes` | missing and requiring persistence | No evidence validity/history store. |
| `ManualEvidence.scope.eventId` / `.sessionIds[]` / `.participantIds[]` / `.communicationIds[]` / `.deliverableIds[]` | missing and requiring persistence | No exact-set evidence scope store. |
| `ManualEvidence.binding.inputSnapshotVersion` / `.artifactVersion` / `.reviewedAtEpochMs` | missing and requiring persistence | No immutable input/artifact review binding. |
| `ManualEvidence.binding.snapshotCompleteness` / `.observationFromEpochMs` / `.observationThroughEpochMs` | missing and requiring persistence | No completeness/observation interval record. |
| `EvidenceValidationContext.catalog` / `.nowEpochMs` / `.expectedRuleId` / `.expectedScope` / `.expectedInputSnapshotVersion` / `.expectedArtifactVersion` / `.referenceRequired` | missing but intentionally runtime-only | Caller-owned validation context; exact values are assembled for validation, not a second evidence record. |
| `ReadinessInput.evaluationTimeEpochMs` | missing but intentionally runtime-only | Caller-fixed readiness calculation time; persist only with a relied-upon readiness snapshot. |
| `ReadinessInput.results[]` | missing but intentionally runtime-only | Canonical evaluator result envelopes; current input is structurally `unknown[]`. |
| `ReadinessInput.exceptions[]` | missing and requiring persistence | No application exception store. |
| `ReadinessInput.exceptionClaims[].ruleId` / `.exceptionId` | missing and requiring persistence | No durable explicit resolution claim. |
| `ReadinessInput.completeObligations.attendanceReconciliation` | derived from existing data | Canonical completion orchestration can derive only after authoritative reconciliation facts exist. |
| `ReadinessInput.completeObligations.requiredFollowUpCompletion` | derived from existing data | Canonical completion orchestration can derive only after operational observations exist. |
| `ReadinessInput.completeObligations.exceptionRecording` | derived from existing data | Canonical completion orchestration can derive only after exception persistence exists. |
| `ReadinessInput.completeObligations.measurementCapture` | derived from existing data | Canonical completion orchestration can derive only after measurement actuals exist. |
| `StageReadinessResult.stage` / `.status` / `.fullyEvaluated` | available from an existing service | Readiness classifier output, descriptive only. |
| `StageReadinessResult.assignedRuleIds[]` / `.applicableRuleIds[]` / `.evaluatedRuleIds[]` / `.missingRuleIds[]` | available from an existing service | Registry/catalog coverage projection. |
| `StageReadinessResult.passes[]` / `.notApplicable[]` / `.failedBlockers[]` / `.unassessedBlockers[]` / `.unassessedAdvisories[]` / `.failedNonBlocking[]` / `.warnings[]` | available from an existing service | Deterministic readiness classification over exact input results. |
| `StageReadinessResult.exceptionResolvedBlockers[]` | available from an existing service | Resolver output only after valid persisted exception/claim input. |
| `StageReadinessResult.unresolvedRuleIds[]` / `.diagnosticCoveragePercent` / `.issues[]` / `.prerequisiteIssues[]` | available from an existing service | Diagnostic projection; percentage is not authoritative readiness. |
| `ReadinessReport.mode` / `.evaluationTimeEpochMs` / `.coverage` / `.stages[]` / `.issues[]` | available from an existing service | Pure readiness report; no current persisted/UI authority. |
| `RuleEvaluationResult.mode` / `.standardId` / `.standardVersion` / `.ruleId` / `.rule` | available from an existing service | Canonical registry output; descriptive only. |
| `RuleEvaluationResult.status` / `.reason` / `.participantId` / `.evidence[]` | available from an existing service | Request-local result; persist only as immutable history when relied upon. |
| `WebinarException.exceptionId` / `.standardId` / `.standardVersion` / `.ruleId` | missing and requiring persistence | In-memory type/validator only; no application record. |
| `WebinarException.requirementOverridden` / `.businessJustification` | missing and requiring persistence | No durable exception submission. |
| `WebinarException.requestor` / `.reviewer` / `.reviewerVerificationStatus` | missing and requiring persistence | No authenticated actor/reviewer binding; current type explicitly remains unverified/not-recorded. |
| `WebinarException.decision` / `.decisionAtEpochMs` / `.expiresAtEpochMs` / `.expirationRequired` | missing and requiring persistence | No lifecycle/history store. |
| `WebinarException.compensatingAction` / `.compensatingActionRequired` | missing and requiring persistence | No durable action/evidence record. |
| `WebinarException.createdAtEpochMs` / `.pilotAudit.pilotReference` / `.pilotAudit.auditReference` | missing and requiring persistence | No immutable pilot audit linkage. |

## 6. Source-of-truth matrix

| Category | Current/future authority | Boundary finding |
|---|---|---|
| Campaign/activity identity | `campaigns`, `activities`, governed activity model | Reuse; do not create engine-owned identity. |
| Webinar occurrence | `webinar_sessions` | Reuse session as occurrence; no parallel event table merely for evaluation. |
| Event status | Future dedicated occurrence lifecycle source | Must not be inferred from participant states. |
| Participant identity | Future authenticated/contact source linked to local participant; current people are synthetic | Do not pretend synthetic name rows are CRM identity. |
| Participant status | Authoritative transition facts plus current projection | Keep registration, waitlist/cancel, attendance, and audience class explicit. |
| Registration | Registration transition history/current projection | Existing table is current state only. |
| Attendance | Per-registrant attendance facts/history | Never aggregate onto event. |
| Communication plan | standard config/communications, Touches, rules/instances | Planning does not prove execution. |
| Communication execution | Future provider/operational observations | No current authority exists; trigger event is not delivery evidence. |
| Assets/destinations | assets, landing pages, CTAs and joins | Artifact existence does not prove QA. |
| Governed taxonomy | Campaign Governance Foundation | Local taxonomy is provisional compatibility data. |
| Naming/campaign code/UTM | Foundation-governed result; local compiler only after compatibility proof | Manual value or documented dependency cannot bypass governed output. |
| QA evidence | Future immutable typed evidence linked to content/source version | QA booleans are current checklist state only. |
| Exception | Future immutable exception + authenticated review record | Manual evidence is not an exception. |
| Readiness | Recomputed engine result over exact source/evidence snapshot | Campaign `readiness` integer is not authoritative. |
| Measurement result | Future occurrence-scoped actual/source record | Generic KPI is not a completion actual. |

Existing boundary risks are:

1. `lib/utm-compiler.ts` computes local formulas and explicitly returns provisional governance.
2. `lib/governance.ts` hosts local terms and resolution marked provisional/not publishing eligible.
3. `validateActor` accepts caller-supplied text and records declared provenance; this is not authentication.
4. Mutable QA booleans can look like evidence but carry no immutable reviewer/content scope.
5. Schedule and trigger rows can look operational but prove only planning/trigger creation.
6. The campaign readiness integer can look authoritative but is not calculated stage history.

## 7. Persist, recompute, transaction, version, and retention assessment

| Category | Recommendation | Business/audit value | Stale/recompute risk | Transaction/version/retention |
|---|---|---|---|---|
| Occurrence/event source facts | Persist authoritative state plus immutable lifecycle history | Core operational identity and chronology | Reconstructing historical status from current session is unsafe | One validated occurrence transition per transaction; optimistic row version; retain per owner/legal policy, not an invented duration. |
| Participant identity/status | Persist authoritative references and immutable transitions; retain current projection | Suppression, reporting, privacy, reconciliation | Current-only upsert loses causality | Transition + projection + audit atomically; external/source event version; retention requires privacy/legal decision. |
| Registration/cancel/waitlist | Persist immutable history and current projection | Immediate path change and audit | Recompute impossible if transitions are overwritten | Source-event/request idempotency; event time distinct from recorded time; retain through required audit window. |
| Attendance/reconciliation | Persist immutable observations/corrections and projection | Per-person follow-up and completion | Provider corrections and unknown resolution cannot be inferred later | Observation + projection transaction; provider/source version; retention decision required. |
| Operational delivery observation | Persist immutable external facts | Only evidence of actual execution | Never derive delivery from plans | Provider event ID/hash uniqueness; append-only; retention/legal rules required. |
| Recruitment/audience plans | Persist authoritative plan intent and creation basis; recompute current projection | Explains obligations and shortened windows | Replans can erase original registration basis | Plan revision + schedule/history transaction; version by standard/occurrence/revision. |
| Schedule projection | Cache/persist with explicit invalidation and history | Efficient UI/export and audit of changes | High stale risk after occurrence/content/state change | Source update + recompute/history atomically or outbox; row/plan revision; caches may expire by policy. |
| QA/manual evidence | Persist immutable typed evidence | Audit, exception eligibility, readiness | Re-creating reviewer judgment is impossible | Evidence and content/input fingerprint commit together; immutable versions; retention at least as long as dependent snapshots, exact duration unresolved. |
| Foundation observation | Persist immutable receipt; cache only exact version/fingerprint/expiry | Proves governed source and availability | Local recompute violates authority; stale/deprecated value risk | Request/receipt/audit atomically; exact source/effective version; retain provenance with dependent records. |
| Individual rule result | Persist source snapshot and recompute by default; persist immutable envelope when relied upon | Diagnostics and audit | Result caches stale on any relevant input/evaluator change | Bind exact standard, evaluator release/fingerprint, calculation time, input refs; invalidate explicitly. |
| Exception resolution | Persist immutable submission/review/claims history | Changes interpretation of failed finding | Cannot safely recompute reviewer decision | Exception + authenticated audit transaction; version original rule finding/evidence; retention unresolved. |
| Readiness stage | Compute on demand; optionally cache with stale/current flag | Four-stage workflow performance | Very high stale risk across data/evidence/dependency changes | Cache exact standard/result summary/input versions; never manual authority; retain relied-upon snapshots. |
| Completion result | Persist immutable snapshot when completion is asserted | Final audit boundary | Recomputing later under changed code/catalog can differ | Snapshot/result commit atomically; exact evidence/exception snapshots; immutable retention policy required. |
| Measurement obligation | Persist plan; recompute applicability | Defines expected measurement | Applicability changes with objective/standard | Version with occurrence/standard/plan revision. |
| Measurement actual | Persist authoritative source fact/history | Completion and reporting | Cannot derive later from target | Source reference/idempotency; corrections append; retention unresolved. |
| Pure presentation projection | Do not persist unless needed for render evidence | Low business value | Easy to regenerate | Request-local; render evidence is separately versioned if a rule needs it. |

Deletion cascades on campaign/session currently remove many webinar facts and plans.
That behavior must not be treated as a rollback mechanism.
Retention, legal hold, and privacy erasure require an explicit owner policy before pilot integration.

## 8. Compatibility with all 21 migrations

| # | Migration | Reusable behavior and integration compatibility/gap |
|---:|---|---|
| 1 | `0001_delivery.sql` | Requires communication/activity association; adds activity tasks and indexes. Reuse Touch/task identity. |
| 2 | `0002_planning.sql` | Adds planning columns, schedule rules/instances/history, immutable original calculation. Reuse plan/history; no `instance_at`. |
| 3 | `0003_webinar.sql` | Adds communication details, sessions, synthetic people, constrained registration/attendance projections. Reuse identities; transition/history states missing. |
| 4 | `0004_governance.sql` | Adds taxonomy relationships, approvals/comments/audit/imports. Reuse metadata/audit patterns, not as typed evidence. |
| 5 | `0005_planning_integrity.sql` | Adds composite campaign uniques/FKs and scheduling integrity. Preserve tenant-safe pattern. |
| 6 | `0006_webinar_integrity.sql` | Adds webinar/communication/audience campaign-safe FKs, history validation/indexes. Preserve composite keys. |
| 7 | `0007_webinar_standard.sql` | Adds first registration time, template/rule fields, configs/communications/variants/schedule links. Reuse plan; exact engine binding absent. |
| 8 | `0008_clics_taxonomy.sql` | Extends taxonomy metadata/validation/indexes. Still not a Foundation receipt. |
| 9 | `0009_webinar_trigger_events.sql` | Adds trigger ledger and successful-registration backfill. Reuse planning history, not provider execution. |
| 10 | `0010_webinar_trigger_event_replay.sql` | Removes timestamp uniqueness and replays successful transitions. Preserve valid replay semantics. |
| 11 | `0011_webinar_template_version.sql` | Backfills existing sessions to `legacy_9`, enforces default/not-null. Template generation is not exact WEB-STANDARD version. |
| 12 | `0012_implementation_tasks.sql` | Adds task stage/blocking/ownership/settings/capacity checks. Reuse setup planning, not readiness/evidence authority. |
| 13 | `0013_utm_taxonomy_categories.sql` | Seeds category registry. Does not connect Foundation. |
| 14 | `0014_governed_activity_model.sql` | Adds governed activity JSON/naming/inheritance, channels, provisional seeds. Reuse activity model. |
| 15 | `0015_activity_model_hardening.sql` | Allows unassigned channel and deprecates invented values. Preserve compatibility/nullability. |
| 16 | `0016_foundation_production_taxonomy.sql` | Adds stable-key/hierarchy uniqueness and provisional seeds/deprecation behavior. Useful compatibility data, not production authority. |
| 17 | `0017_reusable_deliverables.sql` | Adds resource models/joins/checks/release state and CTA legacy canonicalization. Reuse; no generic deliverable/version snapshot. |
| 18 | `0018_validate_landing_page_url.sql` | Validates deferred URL check. Preserve destination validation. |
| 19 | `0019_quarantine_foundation_governance.sql` | Quarantines 98 terms and 13 channels and audits it. Confirms provisional data must not escalate. |
| 20 | `0020_deliverable_reference_constraints.sql` | Converts parent `(id,campaign_id)` indexes to UNIQUE for FK discovery. Follow this ordering before future composite FKs. |
| 21 | `0021_stage_one_deliverable_publish.sql` | Development-only Managed Publish sequencing: permits `Confirmed` and temporarily drops exactly four FKs. It is not production replay, permanent optionality, or rollback design. |

Future additions, without defining schema here, are:

- occurrence lifecycle and participant transition/history sources;
- cancellation, waitlist, audience class, unknown/reconciliation facts;
- provider/source identity and idempotency references;
- immutable setup/configuration/creation/suppression/operational/QA/Foundation evidence;
- exception submission/review history;
- exact standard/evaluator binding and input snapshot references;
- readiness/completion/measurement snapshots where relied upon.

Future constraints should preserve `(id,campaign_id)` uniqueness and campaign-safe FKs.
Likely lookup indexes are `(campaign_id,session_id)`,
`(session_id,person_id,recorded_at)`, and evaluation entity/version/calculation time,
subject to cardinality review.
Parent unique constraints must precede composite FKs, as 0020 demonstrates.

Use versioned migrations and the repaired disposable-database process, never `db push`.
Add nullable fields/tables first, dual-read/write where necessary, backfill deterministically with provenance,
reconcile counts, then add checks/FKs/not-null in a later migration.
Do not manufacture cancellation, waitlist, unknown attendance, provider facts, or Foundation receipts in backfill.
Keep `communication_id`, `schedule_rule_id`, `first_registered_at`, landing-page URL, and approval campaign nullability until a legacy audit supports tightening.
Irreversible transforms require before-state/provenance and a compensating migration.

## 9. Future integration-point contract

| Point and exact location | Input/output and source update | Transaction, idempotency, engine/result | Failure, audit, and tests |
|---|---|---|---|
| Create webinar: `routes/webinars.ts` `POST /campaigns/:id/webinars` | Validated governed Activity plus occurrence setup → session, template/standard reference, plan | Session + version binding + standard plan + anchor in one transaction; `(campaign,activity,occurrence,requestKey)`; evaluate only committed/transactional snapshot; persist source/plan, not permission | Invalid activity/version/Foundation/destination rolls back; audit before/after/version; expand `webinar.test.ts`, standard routes, activity routes |
| Update occurrence: PATCH route and `recomputeWebinarDeliveryAnchor` | Date/time/timezone/duration/status revision → canonical instant and revised plan/history | Source update + schedule history transaction; idempotency by session/anchor revision; rerun scheduling/audience/readiness projections | Preserve previous plan on failure and mark stale; audit affected instances; test DST, past date, reschedule, repeated request |
| Registration: `recordRegistration` | Person/session/source event/result/time → projection, suppression, confirmation obligation | Keep row lock; transition + projection + suppression/outbox/audit atomically; `(session,person,eventType,sourceEventId)` | Retry returns same decision and no duplicate confirmation; test concurrency, repeats, late registration, cancellation/re-registration |
| Cancellation adjacent to registration | Person/session/cancel time/reason/source → cancelled projection and future obligation suppression | New transition source required; transaction state + visible suppressed obligations + audit; source event/request key | Invalid transition rolls back; no customer path after cancel absent reviewed permission; add route/domain tests |
| Waitlist adjacent to registration | Person/session/waitlist/promote facts → status/history/obligations | Source event key; transition + projection + canonical audience plan | Fail closed on incomplete state; audit promotion/non-admission; new tests required |
| Attendance import/reconciliation: `recordAttendance` | Per-person occurrence observation/source/time/correction → attendance projection and follow-up obligation | Observation + projection + evaluation snapshot/history; provider ID/hash | Quarantine malformed/late/conflicting observations; unknown never produces both variants; expand webinar/follow-up/completion tests |
| Recruitment planning: standard planner and `ensureWebinarStandard` | Occurrence, exact standard, audience facts, governed outputs → plan and scheduled intentions | Plan revision/creation snapshot transaction; obligation key `(session,participant,communication,variant,scheduledInstant,revision)` | Failure retains prior plan but marks stale; audit plan delta; scheduling and route tests |
| Reminder planning | Registration basis/current status and occurrence → confirmation/reminder obligations | Same obligation identity; canonical audience planner, not duplicate route logic | No backdated obligations; audit omission reason; registration boundary tests |
| Follow-up planning | Actual end, per-person attendance/reconciliation, variants/evidence → one valid obligation | Source snapshot + canonical engine; immutable attendance basis and variant identity | Missing evidence/unknown blocks or neutral-preview path only; follow-up/completion tests |
| Suppression before future handoff | Complete participant/exclusion facts + planned obligation → eligible/suppressed/reason | Canonical audience/suppression engine; key `(communication,participant,planRevision)`; persist visible decision/history | Fail closed on missing governed exclusion evidence; never alter executed history; REC-005..010 regression tests |
| Readiness calculation | Exact source/evidence/exception/Foundation snapshot → four stage results | Read-consistent snapshot; canonical results; cache only with exact invalidation/version | Unavailable evidence remains unavailable, never pass; audit calculation; readiness dependency/coverage tests |
| Completion calculation | Exact completion/evidence/exception/measurement snapshot → immutable completion result | Snapshot + result transaction; deterministic input fingerprint and request-local projection | Any incomplete/mis-scoped evidence blocks; completion tests and concurrency isolation |
| Exception submit/review | Failed rule, evidence, reason, subject/actor → immutable submission/review | Request key and unique scope; resolver only for eligible rule; authenticated role separation | Reject ineligible/missing evidence/unverified review; audit every action; exception and authorization tests |
| QA evidence | Evidence envelope, source refs, content/input version, actor → immutable record | Fingerprint idempotency; evidence + audit atomically | Reject cycles, invalid provenance/scope; evidence validation/separation tests |
| Foundation observation | Governed request → validated immutable receipt/unavailable result | Request reference + input fingerprint; receipt + audit transaction; no local substitution | Deprecated/unavailable fails closed; governed fixture/prerequisite/batch plus connector contract tests |

## 10. Suppression integration

The nearest current write boundary is `recordRegistration` in
`artifacts/api-server/src/routes/webinars.ts`.
It row-locks the participant, reads prior state, upserts registration,
retains the first registration instant, ensures the standard plan,
and triggers confirmation only on transition into registered.
`evaluateWebinarPerson` is the current read-side planning evaluator.

Future suppression belongs after authoritative registration/cancellation/audience/exclusion facts are recorded
and before any outbox or provider adapter can receive an obligation.
It must invoke the canonical audience/suppression engine, including actual `WEB-REC-010` governed exclusion evidence.
It must not add a hand-authored route-level policy.

The suppression record must:

- suppress future recruitment immediately after registration;
- suppress later customer paths after cancellation;
- exclude internal/test, invalid-address, opted-out/ineligible, waitlisted per approved policy, and governed exclusions;
- retain already executed historical observations unchanged;
- retain omitted/suppressed obligations visibly with canonical reason and source snapshot;
- use stable participant/communication/plan-revision keys for retry safety;
- fail closed when complete population or governed exclusion evidence is unavailable.

No provider boundary was found in the inspected API application roots.
This assessment does not create one.

## 11. Foundation consumption contract

Current `governance.ts`, activity naming, and `utm-compiler.ts` are local/provisional compatibility surfaces.
An implemented evaluator is not a governed observation.
A validated fixture/observation is not a live connection.
No live Foundation integration is connected.

The future request contract should contain:

- request/transaction reference;
- `WEB-STANDARD-001` and exact `1.0-pilot-rc1`;
- event, campaign, occurrence, and capability identifiers;
- exact input version and canonical input fingerprint;
- expected Foundation source/version and effective taxonomy version;
- environment;
- objective/exclusion/naming/code/UTM input values as appropriate.

The future response contract should contain:

- source identity and exact source/rule version;
- effective taxonomy version and non-deprecated status;
- governed taxonomy values, standardized name, campaign code, UTM output, or exclusion decision;
- request reference and matching input fingerprint;
- provenance and immutable observation reference;
- generated, recorded, effective, and expiry instants where applicable;
- environment;
- explicit unavailable/deprecated/invalid reason.

Retry must be idempotent by request reference plus input fingerprint.
Cache only an exact validated receipt by source/effective version, fingerprint, capability, environment, and expiry.
Never silently use stale or deprecated output.
Never allow manual entry or a documented dependency to satisfy a governed output.
Retain immutable receipts and audit history with every dependent readiness/completion snapshot.

The concrete production Foundation endpoint/repository, trust mechanism, and provenance verification remain an owner decision.

## 12. UI data and interaction contracts

### 12.1 Setup

Existing UI:
`EngagementMap.tsx` opens `WebinarSetupDialog.tsx`;
the dialog collects date/time, duration, four timezones, platform, and launch time,
and supplies an empty `speakers` array rather than collecting speakers interactively,
then the campaign mutation creates the activity/session.
It states that emails are not automatically sent.

Required later contract:

- load/save governed Activity and occurrence identity with row version;
- show template family separately from exact standard/version binding;
- collect event lifecycle status separately from participant status;
- expose setup completeness, source/evidence state, and validation findings;
- show Foundation naming/taxonomy/code/UTM availability and provenance;
- never label planner output as sent;
- provide empty/loading/error/stale/conflict/unavailable states;
- attach evidence and exceptions only through typed authorized actions.

Existing labels and Dialog structure provide a partial accessibility base.
Several panel inputs lack explicit label associations.
No code evidence establishes live-region announcements, keyboard/focus completion, or screen-reader result summaries.
The modal and grids have narrow-screen breakpoints, but no browser QA has confirmed mobile behavior.

### 12.2 Recruitment

Existing `WebinarStandardPanel.tsx` loads standard, eligibility, and synthetic people,
shows timing/audience/status, edits variants/config, and exports provisional local JSON.
It has no send, queue, retry, cancel, provider state, real recipient identity, or complete suppression workflow.

Required later contract:

- canonical generated cadence and shortened-window result;
- participant-level eligible/suppressed/omitted obligations with reasons;
- registration basis and current replan distinction;
- visible schedule calculation, timezone, warnings, and stale state;
- complete exclusion evidence and Foundation availability;
- no execution terminology without operational evidence;
- preview/export only under pilot boundary;
- findings and resolution guidance with evidence links.

### 12.3 Follow-up

Current panel edits template variants.
`default_5` has attended thank-you but no approved absent/unknown-neutral model;
`legacy_9` includes attended/no-show rows.
Attendance writes only attended/no_show current state.

Required later contract:

- per-registrant attended/absent/unknown reconciliation;
- actual-event-end and two-business-day clock evidence;
- exactly one valid follow-up obligation;
- distinct attended, absent, and neutral variant identity;
- content version, destination, approval/evidence, due state, and exception state;
- waitlist/cancel/internal/test handling;
- no live send action.

Unknown must not become neutral-eligible before the canonical reconciliation threshold,
and neutral eligibility is not sending authorization.

### 12.4 Readiness

No readiness screen or API aggregate currently exists.
The later data contract must return four separate stages:
ready to recruit, ready to run, ready to follow up, and complete.
Each stage must include passed findings, blockers, warnings, exceptions,
external dependencies, evidence references, stale/current state, and resolution guidance.

Actions are calculate/recalculate, inspect finding, attach valid evidence,
submit eligible exception, review under authorization, and navigate to source correction.
There is no manual “set ready” action and no authoritative percentage.
Unavailable Foundation/evidence remains unavailable.

All four areas require responsive tables/cards, associated labels,
keyboard-operable disclosure, focus management, non-color status semantics,
announced asynchronous/error/stale changes, and desktop/narrow manual QA.
These are contracts, not claims that accessibility testing has passed.

## 13. Legacy and neutral-content compatibility

`legacy_9` and `default_5` exist as persisted template generations.
`ensureWebinarStandard` uses the session’s stored version and preserves template-specific definitions.
Existing sessions can continue using current registration/attendance and planning functionality,
but they lack exact standard/evaluator binding, complete participant state,
typed evidence, exceptions, Foundation receipts, and completion snapshots.
`evaluateWebinarSession` and `evaluateWebinarPerson` are the existing branch-planning evaluator,
not the 106-rule registry.
Consequently, an active legacy session cannot currently receive a safe, certified
WEB-STANDARD-001 evaluation.
A future synthetic, read-only shadow diagnostic may remain incomplete and explicitly non-authoritative;
it must not change template identity, upgrade the session, rewrite communications, or imply certification.

Canonical policy is settled:

- existing sessions stay on their original template version through completion;
- no migration and no mid-cycle upgrade is offered during the pilot;
- after verified pilot acceptance, the standard applies to new creation;
- legacy templates are deprecated for new creation but retained for historical/in-progress records;
- no historical template or communication is deleted or rewritten.

Therefore legacy upgrade timing is not an unresolved question.
No migration/upgrade endpoint should be designed in these increments.
Historical plan changes remain in communications, scheduled instances/history, and trigger history,
subject to the known absence of provider execution evidence.

No approved neutral attendance-unknown copy or approval record was found.
The inspected persisted template/configuration definitions and current webinar UI have
no dedicated neutral placeholder variant either; the mockup-sandbox source search also
found no neutral/attendance-unknown copy. Engine test fixtures are synthetic observations,
not a content approval artifact. Current message content lives in the standard
configuration/communication variants edited by `WebinarStandardPanel`, not in a
governed neutral-content library.
Placeholder content is permitted only in isolated development previews.
It may not be sent to a real recipient.
Attended, absent, and neutral must retain distinct variant identity even when an asset/destination is shared.
The first pilot remains blocked on approved neutral content for readiness modeling,
typed content version and approval evidence, reconciliation evidence, and authenticated approval.
Even approval would not authorize a live send: pilot acceptance expressly prohibits real external messages.

## 14. Security and authorization gaps

No authentication middleware was found in the inspected API application roots.
`validateActor` accepts declared text and `insertAudit` records declared provenance.
That is useful attribution, not verified identity or authorization.

Before future integration, minimum controls are:

| Mutation/capability | Minimum control |
|---|---|
| Evidence submission | Authenticated subject, campaign scope, evidence-source permission, immutable actor provenance |
| Exception creation | Authenticated subject, campaign/rule scope, eligible-rule validation |
| Exception review | Authenticated reviewer role, separation from submitter, immutable decision/audit |
| Readiness override attempt | Explicit denial unless a canonical exception applies; log denied attempts |
| Governed observation ingestion | Trusted connector identity, signature/provenance validation, environment/capability scope |
| Attendance updates | Authenticated integration/operator, occurrence scope, source-event idempotency |
| Operational execution | Separate restricted role and environment approval; still out of pilot scope |
| Deployment | CI/release identity, reviewed migration gate, environment approval and rollback authority |

Reviewer identity remains explicitly unverified until real authentication supplies it.
No current approval should be labeled authenticated.
Positive and negative authorization tests are required for every new mutation.
The role names and separations in this table are recommendations for a minimum private-pilot boundary,
not newly settled product policy.
The owner must select the concrete role model in the decision recorded below.

## 15. Engine orchestration contract and integration risks

The future orchestrator should:

1. Load and validate the canonical catalog.
2. Open one read-consistent occurrence/source snapshot.
3. Fix one caller-supplied `observedAtEpochMs`.
4. Adapt setup, measurement, participant, audience, scheduling, deliverable, evidence, and governed receipts.
5. Invoke the canonical planner modules rather than duplicate business rules.
6. Evaluate each rule in its applicable event or participant scope in dependency order; retain every participant finding.
7. Pass exact result envelopes into prerequisite/readiness/completion contexts.
8. Resolve only valid exception claims against original findings and provenance.
9. Build an immutable completion input snapshot.
10. Call completion-done last.
11. Return a request-local projection.
12. Persist only approved source/evidence/history/result snapshots.

Registry factory merge order is base, setup, scheduling, audience, deliverable,
governed, completion follow-up, completion stage, completion done.
That is binding order, not automatic business dependency execution.
`evaluate(ruleId, context)` evaluates one ID; the adapter owns orchestration.

Two existing implementation details are integration risks, not fixes in this phase:

1. `completion-done.ts` stores mutable process-global `lastProjection`.
   A concurrent request can observe another request’s projection.
   `getLastCompletionProjection()` is not an authority or safe orchestration output.
2. `deriveCompletionRegistryFingerprint` joins catalog rule IDs only.
   It detects ID inventory/order, not rule content, evaluator implementation,
   catalog metadata, dependencies, or engine release changes.

Future integration must not rely on either as audit truth.
This assessment does not change them.

There is also a population-orchestration contract to establish: `EvaluationContext.participant`
selects one participant, while DONE accepts exactly one result for each of the other 105
canonical IDs. A single evaluation over a representative person cannot certify the occurrence.
The adapter must retain participant-level findings and define a deterministic, scope-validated
whole-population reduction for the unique-ID DONE envelope. An applicable participant blocker
or evidence gap must not disappear behind another participant's pass; advisory failures remain
nonblocking and genuine non-applicability remains distinguishable. Do not insert duplicate IDs
into DONE or silently select one person's result. This reduction is missing orchestration, not
permission to introduce new rule meanings. Verify mixed attended/absent/unknown populations,
empty/incomplete populations, and exception scope in Increment 4 before API integration.
Before any evaluation/readiness/completion API is exposed,
the orchestrator must return completion projection data directly in the same request
and must bind snapshots to a stronger engine release identity covering canonical content,
evaluator implementation, dependency/orchestration contract, and catalog metadata.
Named regression gates are:

- concurrent evaluations cannot read or overwrite another request's projection;
- a changed rule body or evaluator implementation changes the release binding even when rule IDs do not;
- a snapshot with a mismatched release binding is rejected as stale/invalid;
- completion replay over the same frozen input and release binding is deterministic;
- no API path calls `getLastCompletionProjection()` as an authoritative source.

Other risks are missing event/participant history, nullable plan links,
synthetic-only people, provisional governance, declared actors,
current-state QA booleans, absent provider observations,
schedule/execution terminology confusion, and undefined retention.

## 16. Sequenced small implementation increments

The acyclic build order is:
**1 → 2 → 2A → 3 → 4 → 5 → 6 → 8 → 7 → 9 → 10 → 11 → 12 → 13 → 14**.
Increment 7 may be developed earlier against isolated fail-closed Foundation fixtures,
but it cannot pass integration or promotion gates until Increment 8 supplies validated receipts.
Legacy routing/non-upgrade guardrails are cross-cutting gates that must ship with Increments 2 through 7,
not deferred to Increment 12.

### Increment 1 — Exact version and persistence design

- Scope: approve source/evidence/result boundaries and migration ERD without implementation.
- Likely files: schema design notes, webinar/catalog adapter contracts.
- Schema impact: planned standard binding, histories, snapshots; none until approved migration.
- Dependencies: retention, Foundation provenance, auth direction.
- Risks: parallel models and over-persistence.
- Gate: architecture review against all 21 migrations and hierarchy.
- Rollback: document-only/design rejection.
- Decisions: retention and concrete Foundation receipt identity.
- Out of scope: routes, UI, connector, sending.

### Increment 2 — Versioned migration foundation

- Scope: add minimum transition/evidence/exception/snapshot structures in ordered migrations.
- Likely files: `lib/db/src/schema/*`, new numbered migrations.
- Schema impact: explicit; nullable-first, composite campaign FKs, idempotency constraints/indexes.
- Dependencies: Increment 1 and repaired disposable migration process.
- Risks: legacy nullability, cascade/retention, FK ordering.
- Gate: fresh database plus upgrade fixture through all migrations and rollback rehearsal.
- Rollback: migration-level rollback/compensating migration; no destructive legacy rewrite.
- Decisions: retention and legal deletion behavior.
- Out of scope: backfilled invented operational facts.

### Increment 2A — Minimum private-pilot authorization

- Scope: establish the smallest authenticated-subject, campaign-scope, role-check, and immutable actor-provenance boundary required before new mutations; this is not full enterprise authentication.
- Likely files: API authentication/authorization middleware, route guards, request subject types, audit actor adapter, and focused authorization tests under the inspected API roots.
- Schema impact: authenticated subject/reference and immutable actor provenance only where approved audit/evidence/exception records require them; no enterprise directory model.
- Dependencies: Increment 1 role decision, Increment 2 audit persistence, existing private access gate.
- Risks: treating declared actor text as authentication, overbuilding enterprise IAM, or allowing submitter/reviewer collapse without an explicit owner choice.
- Gate: unauthenticated and cross-campaign mutation denial; allowed-role positive tests; submit/review separation tests; immutable actor provenance; existing read-only behavior remains compatible.
- Rollback: disable all new mutation endpoints/connector ingestion behind the private-pilot guard; preserve audit records; never fall back to declared actor as verified.
- Decisions: owner selects minimum concrete roles and separation; recommendations here are not settled policy.
- Out of scope: SSO rollout, organization provisioning, SCIM, full enterprise RBAC, public access, and deployment authorization.

### Increment 3 — Read-only domain adapters

- Scope: map existing exact fields into engine contexts without writes.
- Likely files: new adapter beside `webinar-standard-evaluation`, existing service readers.
- Schema impact: none.
- Dependencies: Increment 2 and exact mapping/catalog loader; read-only adapter work does not require mutation authorization.
- Risks: inferring missing status/evidence or conflating template with standard version.
- Gate: fixture tests for complete/missing/invalid mappings and 106-ID non-regression.
- Rollback: remove adapter module.
- Decisions: exact activity-answer mappings.
- Out of scope: readiness persistence and UI.
- Legacy guardrail: route `legacy_9`/`default_5` through their existing planner; any shadow 106-rule diagnostic is explicitly incomplete, non-authoritative, and read-only.

### Increment 4 — Request-local evaluation orchestration

- Scope: deterministic snapshot assembly, prerequisite order, result envelopes, request-local projection.
- Likely files: registry/orchestration service and evaluation tests.
- Schema impact: none initially.
- Dependencies: Increment 3.
- Risks: global `lastProjection`, ID-only fingerprint, clock/scope contamination.
- Gate: concurrency/isolation, deterministic replay, exact-version and stale-input tests; changed evaluator/rule content changes engine release binding even when IDs do not; mixed-population reduction retains all participant blockers/evidence gaps without duplicating DONE prerequisite IDs.
- Rollback: keep existing engine calls; remove orchestrator entry point.
- Decisions: approved evaluator-release fingerprint contract.
- Out of scope: process-global accessor use in an API; request-local projection and stronger release binding are mandatory prerequisites, not deferred API fixes.
- Legacy guardrail: orchestration never upgrades or rewrites a stored legacy template.

### Increment 5 — Registration/cancellation/waitlist transitions

- Scope: immutable transitions plus current projections and source-event idempotency.
- Likely files: webinar routes/service, participant schema, webinar tests.
- Schema impact: transition/state additions approved in Increment 2.
- Dependencies: Increments 2A and 4, migrations, and authenticated subject/campaign scope.
- Risks: duplicate confirmations and legacy projection divergence.
- Gate: concurrency/retry/state-machine/backfill reconciliation tests.
- Rollback: stop dual writes; preserve immutable history; fall back to legacy reads only if reconciled.
- Decisions: none for branch behavior; canonical waitlist rules govern, and missing source facts fail closed.
- Out of scope: real contacts/provider send.
- Legacy guardrail: dual writes must preserve existing template routing and communication identities unchanged.

### Increment 6 — Attendance and reconciliation

- Scope: attended/absent/unknown observations, corrections, actual end, reconciliation evidence.
- Likely files: attendance service/routes, follow-up adapters/tests.
- Schema impact: immutable observations/projection and source IDs.
- Dependencies: Increments 2A and 5 plus participant identity/source contract.
- Risks: conflicting variants and ingestion-time substitution.
- Gate: unknown/two-business-day/correction/idempotency/per-occurrence tests.
- Rollback: retain facts; disable new adapter/projection.
- Decisions: technical source contract must be selected without creating a new product policy.
- Out of scope: platform connector.
- Legacy guardrail: attendance history may feed a non-authoritative shadow diagnostic but cannot certify or upgrade a legacy session.

### Increment 7 — Suppression and obligation planning

- Scope: canonical recipient-level obligations and visible suppression before any handoff.
- Likely files: `recordRegistration`, audience/scheduling adapter, planning readers/routes.
- Schema impact: plan revision, obligation/suppression history if approved.
- Dependencies: Increments 2A and 4–6 plus completed Increment 8 Foundation exclusion receipts for integration-pass; isolated fail-closed fixtures are allowed before Increment 8.
- Risks: bypass path, stale plans, historical execution mutation.
- Gate: `WEB-REC-005` through `WEB-REC-010`, cancellation, internal/test, retry regressions.
- Rollback: disable new projection; preserve decisions/history.
- Decisions: none for canonical waitlist branches; missing waitlist facts fail closed.
- Out of scope: provider adapter or send.
- Legacy guardrail: do not regenerate or replace legacy template communications; apply only compatible source-state suppression visibility.

### Increment 8 — Foundation connector boundary

- Scope: request/receipt validator, idempotency, unavailable/deprecated handling, cache.
- Likely files: governance integration service, connector contract tests, adapters.
- Schema impact: immutable request/observation/audit receipt.
- Dependencies: Increment 2A, production source/provenance owner decision, and trusted connector identity.
- Risks: local fallback becoming authority, stale/deprecated cache.
- Gate: contract/compatibility/failure/retry/provenance tests.
- Rollback: fail closed and return dependency unavailable.
- Decisions: endpoint/repository, trust/version/provenance.
- Out of scope: editable duplicate taxonomy.

### Increment 9 — Evaluation, evidence, exception APIs

- Scope: read calculation endpoint plus typed evidence and exception submit/review endpoints.
- Likely files: webinar routes, evidence/exception services, API schemas/tests.
- Schema impact: evidence/exception/audit records.
- Dependencies: Increments 2A, 4, 7, and 8; request-local completion projection and stronger engine release binding must already pass named regression gates.
- Risks: unauthenticated approval and stale result reuse.
- Gate: authorization, scope, idempotency, ineligible-rule, stale evidence tests.
- Rollback: withdraw mutation routes; preserve audit records.
- Decisions: minimum exception reviewer role.
- Out of scope: override button that bypasses rules.

### Increment 10 — Setup and recruitment UI

- Scope: data contracts for progressive setup and recipient-level simulated recruitment.
- Likely files: `WebinarSetupDialog.tsx`, `WebinarStandardPanel.tsx`, later focused components.
- Schema impact: none beyond APIs.
- Dependencies: Increments 7–9.
- Risks: implying execution/governance finality and inaccessible status.
- Gate: component/API, a11y, desktop/narrow, empty/loading/error/stale tests.
- Rollback: feature gate to existing setup/panel.
- Decisions: none that reopen hierarchy or sending.
- Out of scope: send controls.

### Increment 11 — Follow-up and readiness UI

- Scope: reconciliation, variant/evidence views, four-stage readiness, exception workflow.
- Likely files: new focused workspace components and API clients.
- Schema impact: none beyond approved evidence/result models.
- Dependencies: attendance, evidence, Foundation, readiness APIs.
- Risks: neutral placeholder exposure, manual readiness semantics.
- Gate: attended/absent/unknown, stale recalculation, a11y/responsive tests.
- Rollback: feature gate; retain source/audit data.
- Decisions: exact neutral content/version and approver.
- Out of scope: live delivery.

### Increment 12 — Legacy non-regression and export

- Scope: preserve stored template path and historical schedule while exposing provisional package data.
- Likely files: standard service/export and legacy route tests.
- Schema impact: no legacy rewrite.
- Dependencies: new-creation gate and version adapters.
- Risks: accidental upgrade or standard-plan overwrite.
- Gate: unchanged `legacy_9` and `default_5` routing, plan rows, and historical schedules; any shadow diagnostic remains incomplete/non-authoritative and cannot certify the session.
- Rollback: disable new export/adapter for legacy sessions.
- Decisions: none; no-upgrade policy is settled.
- Out of scope: migration/opt-in/bulk conversion.

### Increment 13 — End-to-end/non-regression gate

- Scope: all canonical scenarios, API disposable database, UI regressions, concurrency and auth.
- Likely files: test suites and verification report only.
- Schema impact: none.
- Dependencies: all implemented increments.
- Risks: aggregate counts masking setup/grouping failures.
- Gate: report files/top-level/nested/leaves/TAP/fail/skip/cancel/TODO/setup/teardown separately.
- Rollback: do not promote; revert failing increment at its boundary.
- Decisions: evidence retention must be settled before acceptance.
- Out of scope: production data and real sends.

### Increment 14 — Deployment-readiness review

- Scope: evidence review, migration rehearsal, privacy/retention, rollback and access gate.
- Likely files: release evidence only.
- Schema impact: none.
- Dependencies: all gates, owner approvals, Foundation availability.
- Risks: treating evaluator coverage as operational readiness.
- Gate: canonical acceptance criteria, manual UX QA, no-send proof, cleanup proof.
- Rollback: no deployment/promotion.
- Decisions: deployment authorization is separate and not granted here.
- Out of scope: public deployment, production delivery, repository consolidation.

## 17. Genuine decisions and blockers

| Exact owner question | Affected rule IDs | Increment | Options and impact | Risk and recommendation |
|---|---|---|---|---|
| Which exact attendance-unknown neutral content/version is approved, and which authenticated owner records approval evidence? | `WEB-FU-UNK-001`, `WEB-FU-UNK-002`, `WEB-FU-UNK-003`, `WEB-FU-VAR-001`, `WEB-RDY-COMP-002`, `WEB-DONE-001` | 6, 9, 11 | A: approve versioned neutral preview content/evidence; B: keep unresolved and block neutral path. Approval supports readiness modeling only, never sending. | Unapproved copy could reach preview/export or be misread as authorized. Recommend B until versioned copy and authenticated approval exist, then A under preview-only controls. |
| What production Foundation API/repository, source identity, exact version/provenance, and trust contract is authoritative? | `WEB-SETUP-003`, `WEB-REC-010`, `WEB-RDY-REC-008`, `WEB-QA-005`, `WEB-QA-006` and governed objective/exclusion prerequisites | 1, 8, 7, 9 | A: API receipt; B: signed/versioned repository artifact; C: no source yet/fail unavailable. Each must provide fingerprint, request reference, effective version, deprecation, expiry, and audit. | Local provisional values could be escalated. Recommend the Foundation-owned supported interface with immutable receipt verification; until selected, fail closed as unavailable. |
| Which minimum authenticated private-pilot roles and separation policy govern evidence submission, exception creation/review, readiness-override attempts, governed observation ingestion, attendance mutation, and operational execution? | `WEB-EXC-001`, `WEB-RDY-COMP-003`, `WEB-DONE-001`, all evidence-bearing rules, and each exception-eligible originating rule | 2A, 5, 6, 8, 9, 11 | A: campaign-scoped submitter plus distinct reviewer; B: central governance reviewer; C: dual approval for selected actions. These are options, not settled role policy. | Declared text could be mistaken for verified approval. Recommend authenticated campaign-scoped subject, reviewer distinct from submitter, immutable audit, connector identity, and explicit denial of direct readiness overrides. |
| What are retention, deletion, privacy-erasure, and legal-hold periods for source facts, operational/evidence observations, exceptions, evaluations, completion snapshots, and delivery history? | `WEB-EXC-001`, `WEB-RDY-COMP-001`–`004`, `WEB-DONE-001`, plus evidence-bearing rules | 1, 2, 2A, 13, 14 | A: category-specific periods; B: one pilot period; C: retain until owner review. Cascades and privacy obligations differ by category. | Premature purge breaks audit; indefinite retention creates privacy risk. Recommend category-specific owner/legal policy before migrations, with dependent snapshot/evidence co-retention and explicit legal hold. |

Settled statuses, not questions:

- Legacy in-progress upgrade timing: no migration or mid-cycle upgrade; preserve original version through completion.
- Webinar hierarchy: webinar is an Activity, never Journey.
- Pilot sending: no real external message, regardless of neutral approval.
- Event status and participant status remain separate.
- Attendance remains per registrant.
- Foundation authority is mandatory and cannot be bypassed.
- Manual evidence is not an exception.
- Evaluator coverage is not operational readiness.

## 18. Final verification and commit scope

The fresh post-document gate passed. Counts below were calculated from the actual
runner output, not forced to match the baseline. They happen to match because no code,
tests or dependencies changed.

| Suite | Files | Top-level records | Nested subtests | TAP records | Grouping records | Leaf tests | Failures |
|---|---:|---:|---:|---:|---:|---:|---:|
| Complete domain suite | 35 | 3,081 | 7 | 3,088 | 1 | 3,087 | 0 |
| Complete API suite, new disposable database | 14 | 69 | 0 | 69 | 0 | 69 | 0 |
| Frontend regression | 1 | 2 | 0 | 2 | 0 | 2 | 0 |
| **Total** | **50** | **3,152** | **7** | **3,159** | **1** | **3,158** | **0** |

The domain runner counts one parent grouping record among its top-level/TAP records;
its seven children are the nested subtests. Subtracting that one grouping record gives
the individual leaf count. Both baseline and final runs had zero failures, skips,
cancellations, TODOs, setup failures, teardown failures and type errors.
Catalog, all evaluator batches, evidence, exceptions, readiness, scheduling, audience,
planning-time/business-day, structural containment and completion tests are included
in the 35 domain files. The frontend suite is the existing two-test ResizeObserver
regression, not a claim of webinar UI journey, accessibility or mobile test coverage.

Commands used for both baseline and post-document checks:

```sh
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*/*.test.ts'
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
pnpm --filter @workspace/api-server run typecheck --incremental false
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
```

The baseline frontend command initially used the default spec reporter; it was rerun
with TAP reporting to make record accounting explicit. No test was changed.
Final logs were retained during execution at `/tmp/phase2b0/final-domain.log`,
`final-api.log`, `final-frontend.log`, `final-typecheck.log`, `final-drift.log`,
`final-coverage.log`, and `final-hashes-pin.log`; this committed document records the
durable results rather than depending on temporary-log retention.

### 18.1 Catalog and implementation integrity

- Non-incremental API typecheck passed with exit status 0.
- Generated rule-ID check: `RULE_IDS_OK: check; 106 rules`; zero drift.
- Fresh runtime registry inspection via `tsx --input-type=module`, plus bidirectional
  canonical/generated/registry tests, yielded
  `{"canonical":106,"implemented":106,"missing":[],"unknown":[],"duplicate":0}`.
- `@js-temporal/polyfill` is exactly `0.5.1` in both the API manifest and its lockfile
  importer `specifier`/`version`; no dependency was changed.
- Registry implementation coverage is **106/106**. This does not make any occurrence
  operationally ready, provide missing evidence, authenticate a reviewer, or connect Foundation.

### 18.2 Migrations and independent cleanup

Both API runs created new isolated PostgreSQL databases using
`lib/db/test/disposable-db.mjs`, including its existing pre-0001 foundation fixture.
No application or production database was migrated. Every migration below reported
`migration-applied` successfully in both runs:

| Migration | Baseline | Post-document |
|---|---|---|
| `0001_delivery.sql` | Pass | Pass |
| `0002_planning.sql` | Pass | Pass |
| `0003_webinar.sql` | Pass | Pass |
| `0004_governance.sql` | Pass | Pass |
| `0005_planning_integrity.sql` | Pass | Pass |
| `0006_webinar_integrity.sql` | Pass | Pass |
| `0007_webinar_standard.sql` | Pass | Pass |
| `0008_clics_taxonomy.sql` | Pass | Pass |
| `0009_webinar_trigger_events.sql` | Pass | Pass |
| `0010_webinar_trigger_event_replay.sql` | Pass | Pass |
| `0011_webinar_template_version.sql` | Pass | Pass |
| `0012_implementation_tasks.sql` | Pass | Pass |
| `0013_utm_taxonomy_categories.sql` | Pass | Pass |
| `0014_governed_activity_model.sql` | Pass | Pass |
| `0015_activity_model_hardening.sql` | Pass | Pass |
| `0016_foundation_production_taxonomy.sql` | Pass | Pass |
| `0017_reusable_deliverables.sql` | Pass | Pass |
| `0018_validate_landing_page_url.sql` | Pass | Pass |
| `0019_quarantine_foundation_governance.sql` | Pass | Pass |
| `0020_deliverable_reference_constraints.sql` | Pass | Pass |
| `0021_stage_one_deliverable_publish.sql` | Pass | Pass |

Both verifiers reported `allMigrations:true`, `migrationCount:21`,
`after0016Present:true`, `registration_unique:true`, `scheduled_constraint_named:true`
and `taxonomy_active:true`.

| Cleanup evidence | Baseline | Post-document |
|---|---|---|
| Disposable root | `/tmp/disposable-pg-bs5rna` | `/tmp/disposable-pg-voMQn1` |
| Cleanup reason | `normal` | `normal` |
| PostgreSQL stopped | true | true |
| Socket removed | true | true |
| Temporary root removed | true | true |
| Independent filesystem absence check | passed | passed |

Passing the test harness does not resolve the documented 0021 production migration
sequencing caveat. Future deployment design requires explicit versioned migration
rehearsal and restoration/validation of intended constraints, not `db push`.

### 18.3 Canonical hash checks

All five files were compared byte-for-byte against functional commit
`12784a94bc46f86b1a37009c1ae83049554b057b` both before assessment and after the
document draft. All match. SHA-256 values:

| File under `docs/standards/webinar/` | SHA-256 |
|---|---|
| `WEB-STANDARD-001.rules.json` | `7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2` |
| `WEB-STANDARD-001.md` | `74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25` |
| `WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md` | `87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f` |
| `CHANGELOG-RC1.md` | `b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c` |
| `manifest.json` | `8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859` |

### 18.4 Scope and ending commit

This document introduces no application code, test, schema, migration, canonical standard,
dependency, service, UI, external connection, sending, publishing, or deployment behavior.
It makes no claim that an `instance_at` field exists, that session `template_version`
is an exact standard version, or that graph edges constitute a Journey.

Only `docs/verification/phase-2b-0-integration-assessment.md` is intended for the document commit.
The attached instruction remains untracked and must not be staged.
The tracked memory note remains preserved.
No delete is part of this assessment.

The ending commit is the commit containing this document, titled
`Document webinar engine integration plan`, with direct parent
`2ee7bc56440c6c249adb3992f239544324425c4b`.
Its generated SHA is reported in the completion response: embedding its own SHA in
this document would change that SHA. Only this document is allowlist-staged.
No implementation increment is authorized or begun by this assessment.