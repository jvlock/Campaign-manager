# Phase 2B-6 — webinar Setup and Recruitment UI

**Status: IMPLEMENTED, CODE GATES PASSING; verification evidence PROVISIONAL — not an unqualified Phase 2B-6 completion.** This document distinguishes inspected code, main-verifier-reported gates and browser observations from untested or unsupported requirements. Browser and automated accessibility checks found no reported failure in their tested scenarios, but not every one of the 68 requested criteria was fully exercised; neither WCAG 2.2 AA conformance nor operational readiness is certified. [Phase 2B-5](phase-2b-5-webinar-api-contracts.md) remains complete **only** for its development-only synthetic API contract. The five canonical files under `docs/standards/webinar/`, Phase 2B-0 accepted assessment/decisions, Phase 2B-1–5 reports, Phase 2B-5 OpenAPI and actual application services are authoritative; an uploaded prompt, memory or simulated UI is not governed product data.

## 1. Starting repository, moving baseline and unchanged invariants

Branch `feature/webinar-standard-engine`. The accepted Phase 2B-5 implementation is `d6cf60de4e7ad790c30e0f75055208b34b2df2d9` (“Expose webinar standard API contracts”), direct parent `db7ad781595ad31718ce0b8ac26b436e2fbf82f3`. At initial Phase 2B-6 preflight, HEAD was `6601124af536a2f8103301570b44de53a187d902`, parent `d6cf60de4e7ad790c30e0f75055208b34b2df2d9`, a commit archiving the **previous** instruction only. During this documentation preflight, HEAD moved again to `0fdbf2893432265d313f23fc3ac129045803d0d6`, parent `6601124af536a2f8103301570b44de53a187d902`, committing **only the current instruction upload** at `attached_assets/Pasted-Phase-2B-5-is-accepted-as-complete-within-its-stated-bo_1790293555273.txt`. Both intervening commits were inspected and contain only instruction archives, **no substantive change to application code, tests, schema, migrations, dependencies, configuration, standards, verification evidence or product requirements**. The accepted substantive baseline therefore remains `d6cf60de4e7ad790c30e0f75055208b34b2df2d9`; the direct parent of an eventual Phase 2B-6 commit depends on the main agent's final HEAD and is **not claimed here**. Do not amend or rewrite those commits.

At the original no-edit preflight the new Phase 2B-6 instruction archive was the sole current upload to exclude from task changes; tracked tree was clean. The present worktree has in-scope server-contract, generated-client and frontend changes owned by other agents; these are *not* an unreviewed intervening commit and this documentation author has not edited them. No staged changes were observed at this inspection. The entire accepted Phase 2B-5 commit changed **166 files**, including 145 individually enumerated generated Zod types and 21 other application/spec/test/verification paths; [the Phase 2B-5 report's changed-file appendix](phase-2b-5-webinar-api-contracts.md#changed-file-inventory-and-commit-boundary) identifies every path. Its scope was API/service/OpenAPI/generated contract/tests/classification, not Setup/Recruitment UI. The **54-path Phase 2B-6 worktree inventory** is recorded below and requires reconciliation against the eventual physical commit; exclude instruction uploads and unrelated artifacts.

The main verifier reports a fresh accepted starting baseline at `/tmp/phase2b6-baseline`; attributed here, **not rerun by this documentation author**:

| Suite | Files | Top-level records | Nested records | TAP records | Grouping records | Leaf tests |
|---|---:|---:|---:|---:|---:|---:|
| Domain/evaluator/Foundation | 40 | 3,134 | 7 | 3,141 | 1 | 3,140 |
| Complete serial API | 28 | 152 | 0 | 152 | 0 | 152 |
| Frontend resize | 1 | 2 | 0 | 2 | 0 | 2 |
| Generated-client pagination | 1 | 3 | 0 | 3 | 0 | 3 |
| Restricted/private/open-development | 1 | 2 | 0 | 2 | 0 | 2 |
| **Nonoverlapping accepted baseline** | **71** | **3,293** | **7** | **3,300** | **1** | **3,299** |

Main-verifier baseline: **zero failures, skips, cancellations, TODOs, setup or teardown failures** in these final accepted runners. An **initial misconfigured private-suite attempt did not pass** and is not counted as the corrected final gate. Server/frontend nonincremental typechecks, all five unchanged canonical hashes, exact `@js-temporal/polyfill` **0.5.1**, 106/106 canonical evaluator IDs/direct registry and drift check, unchanged in-order **25 migrations (0001–0025)** and upgrade-preservation **57 / 60 / 44** passed. Disposable private database roots `KKW5s8` and `Vcw6wh` were shut down and cleaned. These are **Phase 2B-6 pre-implementation baseline results**, not Phase 2B-6 final verification.

The accepted APIs use `/api/campaigns/:campaignId/webinars/:sessionId/standard/{summary,evaluations,readiness,completion,evidence,exceptions,history}` and fail-closed exception-review contract; existing `/api/development/foundation/observations` GET/refresh distinguish synthetic taxonomy from five unsupported outputs. Development policy requires isolated synthetic database and same-origin mutations. Exception review rejects clients without trusted reviewer identity. The standard is `WEB-STANDARD-001` with 106 evaluator IDs, not an operational permission. No live Foundation connector exists; taxonomy may be available from the configured synthetic fixture, while governed naming, campaign code, UTMs, objectives and exclusions are unavailable. No customer-data processing is authorized.

## 2. Existing frontend inventory before Phase 2B-6 UI

| Concern | Observed established pattern and bounded implication |
|---|---|
| Navigation and hierarchy | React/Vite app uses `wouter` in `artifacts/campaign-workspace/src/App.tsx`: home, `/development`, `/governance`, `/portfolio`, `/campaigns`, `/campaigns/new`, `/campaigns/:id`. `pages/campaigns/Detail.tsx` hosts strategy, Engagement Map, calendar, deliverables, delivery and presentation tabs and manages campaign context through URL query `tab`/`activity`. `components/map/EngagementMap.tsx` opens `ActivityConfigDrawer` for a selected Activity; webinar Activity links to a `webinar_sessions` occurrence. **No separate webinar application, Journey object inference or root-level Setup route is assumed.** Hierarchy stays Campaign → optional Journey → webinar Activity → communications/touches → deliverables. |
| Existing webinar surfaces | `ActivityConfigDrawer.tsx` obtains scoped `useListWebinars`, `useGetWebinar`, legacy `useEvaluateWebinar`, and `useUpdateWebinar`; `WebinarStandardPanel.tsx` displays and edits local provisional template/copy/eligibility via existing standard hooks and supports draft export. `WebinarSetupDialog.tsx`, `ActivityNode.tsx`, `SyntheticParticipantSimulator.tsx`, `CommunicationDeliverablesEditor.tsx`, campaign calendar/delivery/deliverables and `Development.tsx` already exist. The legacy standard panel is **not** the 106-rule canonical persisted evaluation workspace; retain established legacy behavior and avoid duplicate resource models. |
| Data and mutations | Generated React API hooks and OpenAPI/Zod schemas live in `lib/api-client-react`, `lib/api-spec` and `lib/api-zod`; `@tanstack/react-query` caches/invalidation drive reads and writes. Campaign strategy saves with `rowVersion` and shows a 409/428 conflict preserving draft. Existing webinar panel queues saves and retains dirty local edits during refetch, but accepted historical standard writes may have lacked an explicit server edit-version guard; the Phase 2B-6 UI **must** supply `expectedVersion` on every new editable webinar/standard write rather than mistake a client queue for server concurrency protection. Existing status and runtime errors use inline `role="alert"`, `useToast`, loading spinners, partial queries and explicit empty states; no global success-envelope convention should be invented. |
| Design language | `src/index.css` defines Tailwind semantic HSL tokens (`background`, `foreground`, `primary`, `muted`, `destructive`, `sidebar`, `accent`, `ring`, card/border) with Plus Jakarta Sans for body and Space Mono for mono, 0.5rem radius and `0.25rem` base spacing; primary blue `216 100% 50%`, secondary teal `190 100% 42%`, navy foreground/sidebar `214 60% 11%`, destructive red `0 84% 60%`. Existing webinar/map surfaces use green/emerald and `ProvisionalBadge`; amber warnings and muted neutrals are available. **Green webinar family is provisional presentation, not a production governance badge**; distinguish purple/simulation text and icons, amber warning, red blocker, gray unavailable. Status must remain text/icon plus color. |
| Reusable controls | Radix/shadcn `components/ui` includes Button, Input, Select, Checkbox, RadioGroup, Tabs, Accordion, Collapsible, Card, Badge, Progress, Breadcrumb, Dialog, AlertDialog, Sheet, Drawer, Tooltip, Skeleton, Alert/Toast/Sonner and responsive Sidebar; `lucide-react` supplies calendar, clock, people, mail, shield, warning, lock, history and check icons. Existing map has Activity configuration drawer and timeline/calendar context. **No bespoke approved stepper or recruitment timeline component was located at baseline**; reuse tabs/progress/semantic list or build only the minimal scoped component. Existing responsive classes use `sm`, `md`, `lg` (e.g. mobile-first setup dialog, desktop campaign header and `lg:grid-cols-2` Development); concrete desktop/tablet/mobile behavior still requires browser verification. |
| Accessibility / test tooling | Existing UI has `aria-live`, `role="alert"`, named loading state and semantic Radix controls; `scripts/resize-observer.test.mjs` uses Node tests. Backend and generated-client suites use their own runners. No established workspace Playwright/Cypress browser suite or automated axe integration was found in the frontend package during preflight; if one is introduced, its necessity, output and scope must be documented. Browser scenarios and **manual keyboard/screen-reader/responsive checks** remain required; no automated scan alone can establish WCAG 2.2 AA. |

## 3. Bounded integration design (runtime verification pending)

**Entry and information architecture:** the existing Campaign → Engagement Map → selected webinar Activity/occurrence exposes one integrated workspace with **Setup** and **Recruitment** active; **Follow-up** visible as next-phase/unavailable and **Readiness** a read-only concise engine status, not the full workflow. Header shows campaign, optional actually linked Journey (never inferred), webinar Activity/title, occurrence date/time and stored timezone, event status, step progress, current issue/next action, distinct saved/evaluated timestamps and an unmistakable synthetic-development marker. Setup groups Why/Who/What/When/Where/How into small guided decisions and a review grouped by complete/recommended/warnings/blockers/unavailable capabilities/missing evidence/stale results. Recruitment orders existing engine/API-derived planned touches around the event, with progressive card detail, recorded suppression reason, destination/content/evidence status and overdue/shortened-window treatment. Where the API lacks actual-send evidence, **historical execution is unknown**, not guessed. ~21/14/7/1-day cadence is not hardcoded as new evaluator logic.

**API/service mapping:** canonical summary/evaluations/readiness/completion, six Foundation output states, evidence/exception/history and existing webinar/communication/deliverable resources use generated clients. `POST .../standard/evaluations` is a development diagnostic with UUID idempotency key, server revision and fixed calculation instant available only behind the accepted isolation boundary; UI cannot claim it sends or approves. The bounded authorized server prerequisites reuse **existing** webinar session and standard mutation services with a semantic `editVersion` / UI-supplied `expectedVersion` optimistic check (legacy clients may omit it for compatibility); a read-only `POST .../date-impact-preview` produces impact before any date save, reusing the accepted engine scheduling calculations and not mutating data. A separately discovered evidence-source **read-projection correction** to existing GET evidence supplies persisted occurrence-scoped source UUID/type/version/hash and usability at the read's as-of/release, not a new source model or a change to strict POST validation. None adds a parallel webinar model, rules engine, schema or migration. The frontend requires review/confirmation, guarded save, refetch/re-evaluation and visible staleness.

**Authorization and states:** never promote local planning objective/naming/destination to a Foundation-governed result. Synthetic taxonomy can carry a visible Simulation label; other outputs remain unsupported/unavailable; configured does not mean connected. Evidence remains an unverified source reference and never auto-passes a rule. Draft exception requests remain unreviewed; trusted review is unavailable, typed identities do not grant it, and `WEB-EXC-001` cannot exempt itself. A planned communication is not sent; cancellation does not silently restore recipient eligibility; internal/test audiences stay excluded. No preview or evaluation is evidence of operational execution.

**Client safety and resilience (runtime verification pending):** preserve valid unsaved form data on validation, conflict and network failures; distinguish local dirty state, save confirmation and calculated snapshot time; never silently overwrite newer server edits. Suppress exact duplicate in-flight saves, allow safe retry after failure and explain expected-version conflicts. Before moving the webinar instant, show affected touches, changed deadlines, shortened-window/overdue effects and a confirm step; a nonmutating preview is **not** the save itself. Isolate loading/error/empty states by region so Foundation failure does not blank Setup, and disclose rule findings progressively. Use keyboard-accessible semantic list/controls, linked error summary and focus management, live status announcements, readable contrast/icons/text, reduced-motion support, and mobile layouts without overflow. These are **acceptance criteria**, not verified browser outcomes yet.

## 4. Inspected Phase 2B-6 code and authority boundaries

This section describes **code observed**; §6 separately reports real browser interactions. `App.tsx` adds `/campaigns/:id/webinars/:sessionId/setup`; the existing `ActivityConfigDrawer.tsx` links to that route for an occurrence associated with the webinar Activity. Its legacy suppression control is disabled/read-only, and the new `WhoStep` has no suppression toggle. `WebinarWorkspace.tsx` loads campaign, occurrence, standard, summary, readiness, evaluations, evidence, exceptions and history through generated scoped React Query hooks. It renders Why/Who/What/When/Where/How/Review, an active Recruitment area, unavailable Follow-up and concise read-only Readiness. It has a campaign breadcrumb, explicitly labeled synthetic-development ribbon, event/timezone, stage-derived next action/blocker and readiness, separate saved/evaluated times, stepper, desktop task panel/mobile Sheet, AlertDialog on unsaved navigation and aria-live status. Campaign Journey context is not invented where no linked model is available. `setup.tsx` offers editable audience variants and speakers, a **read-only internal planning title**, explicit date/start/timezone/duration/recruitment-launch inputs and configured-not-connected platform choices; objective, governed naming, exclusions, geography/language/waitlist and unsupported operational destinations are honestly read-only or unavailable. `ReviewStep` groups passed, recommended, warnings, blockers, unavailable, missing coverage/evidence and stale issues.

`recruitment.tsx` renders a semantic ordered communication list around an event anchor with collapsible cards, progressive green rails, engine timing descriptors and stable `sortOrder`/key ordering. It distinguishes planned/suppressed/cancelled/unscheduled plan state and displays suppression/skipping reasons, CTA/content/destination/rule findings. The panel presents **engine readiness**, not a locally calculated readiness claim. No API execution-evidence or actual-send timestamp is present; actual execution and history of sends are labeled **unknown**, never fabricated as sent or a verified future plan. The UI never checks local wall-clock time to infer overdue: `WebinarWorkspace.tsx` calls the backend nonmutating preview for the **current** occurrence/version and displays overdue from its `previous.overdue` as of `calculatedAt`; an unavailable/stale preview means “Overdue unknown.” Passage of time may naturally change a later preview's overdue result without changing scheduling semantics. Touches can remain visible when skipped/suppressed. No send control exists.

`WebinarWorkspace.tsx` builds minimal per-section patches, never includes `registrationRule` **or `name`**, and sends `expectedVersion` for each new session/standard mutation. The existing planning title is read-only: a direct session `name` update was rejected with 400 because the accepted API authorizes `namingInput` only on Activity creation, not an update; **speakers are truly editable and persisted on reload**. It preserves drafts after errors, guards dirty navigation/back/unload, handles newer-version conflicts explicitly, prevents identical in-flight saves, links validation errors and announces outcome. Before a timing save, it calls `POST /campaigns/:id/webinars/:sessionId/date-impact-preview` with `expectedVersion`, shows original/proposed instants, newly overdue and shortened-window effects in a confirm dialog, then saves with the preview's version and requests re-evaluation; the preview does not mutate persisted state. The bounded server prerequisite computes a semantic SHA-256 edit version, excludes timestamp housekeeping, and applies guarded writes; **legacy clients can omit `expectedVersion` for compatibility, but the new UI does not**. Preview scheduling invokes the established engine decision and reads existing scheduled instances, including terminal skipped ones; it does not create new rules or rewrite stored dates. The restricted/private/open-development server-contract suite also tests the **16-KiB session PATCH safeguard** (see code gates).

`status.tsx` supplies icon+text StatusChip, purple SimulationBadge, touch/keyboard accessible popover explanation and explicit nine-state governed-capability presentation; `evidence.tsx` restricts submissions to **GET evidence's persisted scoped source UUID/type/version/hash marked usable**, with fixed retry tuple, labels submitted evidence unverified, allows only eligible **draft** exception requests, displays immutable history and explains why trusted review is unavailable. The first attempted frontend evidence flow revealed that engine provenance strings were **not** persisted source UUIDs; the narrow `GET .../standard/evidence` projection fix supplies the existing immutable source identities and existing eligibility checks. GET is a read-as-of view, not reservation or consumption of a source; strict POST independently rechecks identity/version/hash/revision/receipt under lock. No typed reviewer identity or approval action exists. `adapters.ts` normalizes errors and maps authority without changing canonical schedule/readiness; `rule-routes.ts` maps known rule IDs, `navigation-guard.ts` manages browser Back. `index.css` adds scoped `ww-*` provisional green, differentiated recruitment shades, amber/red/blue/gray/purple status palettes, visible focus/44px targets and reduced-motion override. Analytics is **proposed only** if approved instrumentation is unavailable: setup started/completed/validation failed, recruitment viewed/card expanded, guidance opened, evidence started, evaluation requested, error and abandoned dirty workflow. Do not emit customer data, free text or secrets.

Seven focused Node/TSX frontend files now exist in `src/__tests__/webinar-{a11y-static,adapters,authority,components,evidence-sources,guard,save}.test.{ts,tsx}`: adapter authority, deterministic ordering, stale/conflict/date-impact mapping, read-only suppression, unknown execution/overdue, exact persisted evidence sources, status/validation, dirty Back guard, static accessibility landmarks/contrast-friendly surfaces and minimal saves. The frontend test command uses `tsx 4.23.13`; `axe-core 4.10.3` is added for development-only accessibility checking. The lock change is scoped to development importers, not a runtime vendor. Static rendering/unit and axe tests are **not** a WCAG certification.

## 5. Final reported code gates (distinct runner units)

The main verifier reports the final corrected code-gate artifacts at `/tmp/phase2b6-final-gates`. Earlier **4 / 24**, **5 / 30** and **76 / 3,330** snapshots are **superseded** by this latest snapshot, not additional tests. The table retains TAP nesting separately from top-level records and counts one grouping record, not an extra leaf:

| Nonoverlapping suite | Files | Top-level records | Nested records | TAP records | Grouping records | Leaf tests |
|---|---:|---:|---:|---:|---:|---:|
| Domain/evaluator/Foundation | 40 | 3,134 | 7 | 3,141 | 1 | 3,140 |
| Complete serial API | 28 | 154 | 0 | 154 | 0 | 154 |
| Frontend webinar UI | 7 | 43 | 0 | 43 | 0 | 43 |
| Frontend resize | 1 | 2 | 0 | 2 | 0 | 2 |
| Generated-client pagination | 1 | 3 | 0 | 3 | 0 | 3 |
| Restricted/private/open-development | 1 | 2 | 0 | 2 | 0 | 2 |
| **Distinct suite total** | **78** | **3,338** | **7** | **3,345** | **1** | **3,344** |

**Reported zero** failures, skips, cancellations, TODOs, setup failures and teardown failures in the configured accepted runners; zero type, migration, preservation and cleanup failures. Server/frontend **nonincremental** typechecks passed. The serial API run includes the 16-KiB PATCH safeguard and the newer persisted-evidence-source GET read-projection regression. The fresh disposable verification database `vKiIMB` received all **25 byte-identical migrations** and passed normal and absent-projection upgrade-preservation **57 / 60 / 44**. Earlier disposable roots `EaZOER` and `NoDMJi` were also shut down and cleaned; those results are unchanged, not replacements for the latest database. Direct evaluator registry/drift remained **106/106**, all **five** canonical file hashes unchanged, Temporal pinned **0.5.1**, OpenAPI validated at **112 operations / 594 references**. Browser/axe observations are reported separately below rather than counted as TAP leaves. These are main-verifier-reported results, not suites rerun by this documentation author.

## 6. Browser scenarios and accessibility: observed scope and limitations

The main browser verifier used only synthetic development fixtures. A previously seen startup 500 when no URL was available was **not reproduced in the latest normal browser logs**; it is not counted as a final passing workflow scenario or hidden as a substantive application regression.

| Scenario | Reported actual observation | Boundary / missing proof |
|---|---|---|
| **A — Setup** | Entered from existing Activity drawer link into scoped route; Setup/review navigated, title shown as **read-only planning title** after rejected direct-name API update, speaker persisted after reload; dirty section/back guard allowed keep/discard. | The complete guided authoring of unsupported objective/geography/naming is not possible and is disclosed. No separate Journey fixture evidenced. |
| **B — Recruitment** | Engine-ordered cards and six-touch obligations visible; no send control. Registration rule presented as required/read-only. | Actual historical send/execution **unknown**: no execution-evidence API or actual-send timestamp. Do not report historical execution as proven. |
| **C — Date impact** | June 20 proposal: preview **5 changed / 0 newly overdue / 0 shortened**, did **not** persist. June 10 proposal: preview **5 changed / 1 shortened**, confirmed; five instants persisted; re-evaluation returned current synthetic results **blocked, 7/105**. | Preview's overdue result is as-of the backend `calculatedAt`, not a live client clock; no new scheduling semantics. “7/105” is scenario evaluation, **not** evaluator registry coverage or operational readiness. |
| **D — Synthetic registration** | Through approved development API recorded **1 synthetic registered** participant; `recruitment_1` showed `prohibited` with `registration_suppresses_recruitment`, UI showed **1 registered / 6 suppression obligations / Suppressed**. | Real customer records, cancellation-eligibility transition and historical sent-touches not exercised; historical execution remains unknown. |
| **E — Foundation** | Refresh showed **Simulation** taxonomy only; naming, code, UTM, objective and exclusions remained unsupported/unavailable. No live provider claim. | No real Foundation connection or operational smoke test. |
| **F — Evidence / exception** | An initial attempted source-selection flow found engine provenance was not the immutable persisted source UUID. After narrow GET projection correction and frontend adaptation, browser chose **Source observation → usable foundation source → Record unverified evidence once**; POST succeeded, UI showed unverified actor/result unknown/not a pass; backend recorded **27, unknown actor, false authentication, true unverified**. Exception review unavailable/no typed identity displayed. | Available-source GET reflects state as of read and **does not consume/reserve** source; strict POST rechecks. A positive pre-existing exception-record view was **NOT EXERCISED** (no fixture); trusted approval was neither available nor attempted. A radio-selection ambiguity during intermediate testing was not established as a code defect. |
| **G — Recovery/concurrency** | Single intercepted **503** retained exact form input; retry succeeded. A second client's synthetic speaker mutation succeeded with 200; stale UI save received **409**, retained its draft and offered “Load latest,” which recovered the server value. Duplicate in-flight controls observed. | Additional provider-outage permutations and cross-section partial-query failures not all browser-exercised. |
| **H — Layout / keyboard / axe** | Layout checked at **1440×900**, **1366×768**, **768×1024**, **1024×768**, **390×844**, with no horizontal overflow after header fix; scoped manual keyboard navigation passed. Initial axe scan found **4 violations**; after fixes for main landmarks, open-development banner roles, flat contrast-resolvable surfaces and duplicate IDs, completed scan: **0 violations, 36 passes, 3 incomplete categories** (`aria-hidden-focus`: 5 nodes, `color-contrast`: 1 node, `duplicate-id`: 3 nodes). Manual DOM check found **0 duplicate IDs** normal/open Sheet; eight Tabs stayed within Radix Sheet, with no background focus; normal page had zero focusable descendants in hidden frames/shadows. Visible dark foreground sampled around RGB 11/26/45 and blue focus ring; reduced-motion CSS override exists. | Three automated **incomplete** categories require human review: Radix modal hides background with focusable DOM but focus is trapped; this alone is not an automatic failure. No full manual screen-reader/contrast audit or browser reduced-motion emulation was reported. **Do not claim WCAG 2.2 AA conformance solely from axe/manual scoped keyboard checks.** |

## 7. Minimum-case matrix (all 68; observed versus limited)

Legend: **B** = reported real browser action; **C** = reported code/API/component gate; **S** = source/static UI inspection; **L** = explicitly limited/unexercised. A code or static assertion does not become a browser pass. Scenario letters refer to §6.

| # | Requirement and evidence | Disposition |
|---:|---|---|
| 1 | Eligible synthetic occurrence opens via existing Activity drawer (A). | B |
| 2 | Non-webinar/ineligible states rendered and unit-tested; no complete negative browser fixture. | C, S; L |
| 3 | Campaign breadcrumb observed; optional Journey only if linked; no Journey fixture. | B, S; L |
| 4 | Setup and Recruitment active in route (A, B). | B |
| 5 | Follow-up visible with reason unavailable. | B, S |
| 6 | Readiness only concise engine summary, no full workflow. | S |
| 7 | Current Setup step in semantic stepper (A). | B |
| 8 | Task panel identifies next action and blocker (A). | B |
| 9 | Timezone/select/radio/variant choices structured; governed objective unavailable (A). | B, S |
| 10 | Only authorized planning input open; title read-only, speaker editable; no governed naming input. | B, S |
| 11 | Speaker section save persisted and reloaded via existing API (A). | B |
| 12 | Intercepted 503 preserved exact input; retry succeeded (G). | B |
| 13 | Identical in-flight submission guarded; double-pending behavior observed (G). | B, C |
| 14 | Second-client update 200, stale save 409, draft retained (G). | B |
| 15 | Dirty section and Back warn/keep/discard (A). | B, C |
| 16 | Untouched clean draft does not warn in guard unit tests. | C; no separate browser trace |
| 17 | Date preview lists five affected communications (C). | B |
| 18 | Preview exposes backend overdue counts; specific June 20 0, June 10 1 shortened; newly overdue positive fixture not independently reported. | B, C; L |
| 19 | Postdate reevaluation current; prior results marked stale until recalculation. | B, C |
| 20 | Cadence uses engine descriptor, never locally hardcoded offsets. | C, S |
| 21 | Sort by engine `sortOrder` then key, tested. | C |
| 22 | Suppressed/skipped communications remain in list; synthetic fixture (D). | B |
| 23 | `registration_suppresses_recruitment` displayed (D). | B |
| 24 | No historical send evidence: “Execution unknown” rather than future/sent; cannot show actual executed fixture. | B, C; L |
| 25 | No planned touch presented as sent; no send control (B). | B, C |
| 26 | Registration suppression explained in Who and Recruitment (D). | B |
| 27 | Cancellation does not silently restore eligibility in UI copy/API tests; no browser cancellation transition. | C, S; L |
| 28 | Internal/test exclusions visible, read-only; no bypass (D). | B, S |
| 29 | Stage readiness directly from API, labeled simulation/non-operational. | C, S |
| 30 | Warnings distinct from blockers in review/components. | C, S |
| 31 | Resolved blocker retains underlying original failed finding; no positive browser exception fixture. | C, S; L |
| 32 | Missing evaluator coverage shown as incomplete, not a pass. | C, S |
| 33 | Synthetic taxonomy labeled Simulation (E). | B |
| 34 | Governed naming unavailable (E). | B |
| 35 | Campaign code unavailable (E). | B |
| 36 | UTM output unavailable (E). | B |
| 37 | Governed objective unavailable (E). | B |
| 38 | Governed exclusions unavailable (E). | B |
| 39 | Provider-not-configured versus unavailable distinct in adapter tests/UI; no live provider failure fixture. | C, S; L |
| 40 | Unsupported shown explicitly, not blank success (E). | B, C |
| 41 | Production-mode synthetic refresh disabled by development policy/API; no production-mode browser trial. | C; L |
| 42 | Actual evidence POST did not auto-pass a rule (F). | B |
| 43 | Actor unknown, unauthenticated, record unverified (F). | B |
| 44 | Trusted exception review unavailable and explained (F). | B, C |
| 45 | No typed identity input activates review (F); no auth bypass browser attack. | B, C |
| 46 | Only failed eligible blockers offer draft request; no positive exception fixture. | C, S; L |
| 47 | Structured API validation maps to fields; 400 title attempt led to read-only correction; no exhaustive field-level browser test. | C, S; L |
| 48 | Accessible global error summary and intercepted 503 (G). | B, S |
| 49 | Scoped keyboard walkthrough of both workflow areas passed (H). | B |
| 50 | Validation summary focuses/links fields in source; no complete manual assistive-technology error-focus audit. | C, S; L |
| 51 | Status icon+text, not color alone (H). | B, C |
| 52 | Final axe **0 violations**, 36 passes, **3 incomplete categories**; serious/critical reported zero among completed checks, incomplete not treated as passes. | B; L |
| 53 | Scoped manual keyboard navigation passed; not a complete WCAG audit (H). | B; L |
| 54 | 1440×900 desktop (H). | B |
| 55 | 768×1024 portrait and 1024×768 landscape tablet (H). | B |
| 56 | 390×844 mobile (H). | B |
| 57 | No horizontal overflow at five viewports after header fix (H). | B |
| 58 | Recruitment semantic `<ol>` available without visual-only timeline. | B, S |
| 59 | Skeleton exists; material layout shift not instrumented/measured. | S; L |
| 60 | Isolated query/error regions; one intercepted 503 passed, multi-region partial failure not exercised. | B, S; L |
| 61 | Staleness shown across date change and evaluation (C). | B |
| 62 | Saved/evaluated timestamps separate in task panel. | B, S |
| 63 | Existing campaign drawer/map route opened (A); entire route regression browser sweep not done. | B; L |
| 64 | Non-webinar drawer remains on old path by source; dedicated browser regression not evidenced. | S; L |
| 65 | Existing webinar panel still accessible/guarded by version; no exhaustive legacy browser suite. | C, S; L |
| 66 | Phase 2B-5 contract regressions included in complete 28-file API run. | C |
| 67 | 106/106 registry/direct drift check passed. | C |
| 68 | All 25 migrations byte-identical and in-order on disposable DB. | C |

## 8. Exact observed changed-file inventory, limitations and classification

At evidence finalization, `git status --short --untracked-files=all` showed **27 modified tracked + 27 untracked = 54 paths**; no instruction upload, `.agents/memory/`, temp output, migration or canonical standard appears in this worktree change set. The `TESTING.md` path below is a frontend test-support artifact owned by the implementation agent, **not** another verification report edited by this documentation author. This is a **pre-commit worktree inventory**, not a claim about eventual committed files; main agent must verify actual staged/committed diff and parent before committing.

**Modified tracked (27):**

```text
artifacts/api-server/src/app.ts
artifacts/api-server/src/lib/development-policy.ts
artifacts/api-server/src/lib/webinar-standard.ts
artifacts/api-server/src/routes/development-webinar-api.ts
artifacts/api-server/src/routes/webinars.ts
artifacts/api-server/test/development.routes.database.ts
artifacts/api-server/test/webinar-standard-api.database.ts
artifacts/api-server/test/webinar-standard.routes.test.ts
artifacts/campaign-workspace/index.html
artifacts/campaign-workspace/package.json
artifacts/campaign-workspace/src/App.tsx
artifacts/campaign-workspace/src/components/layout.tsx
artifacts/campaign-workspace/src/components/map/ActivityConfigDrawer.tsx
artifacts/campaign-workspace/src/components/map/WebinarStandardPanel.tsx
artifacts/campaign-workspace/src/index.css
artifacts/campaign-workspace/tsconfig.json
lib/api-client-react/src/generated/api.schemas.ts
lib/api-client-react/src/generated/api.ts
lib/api-spec/openapi.yaml
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/index.ts
lib/api-zod/src/generated/types/webinarApiEvidenceList.ts
lib/api-zod/src/generated/types/webinarSession.ts
lib/api-zod/src/generated/types/webinarStandard.ts
lib/api-zod/src/generated/types/webinarStandardPatch.ts
lib/api-zod/src/generated/types/webinarUpdate.ts
pnpm-lock.yaml
```

**Untracked (27, including this report):**

```text
artifacts/api-server/src/lib/webinar-edit-version.ts
artifacts/campaign-workspace/TESTING.md
artifacts/campaign-workspace/src/__tests__/webinar-a11y-static.test.tsx
artifacts/campaign-workspace/src/__tests__/webinar-adapters.test.ts
artifacts/campaign-workspace/src/__tests__/webinar-authority.test.tsx
artifacts/campaign-workspace/src/__tests__/webinar-components.test.tsx
artifacts/campaign-workspace/src/__tests__/webinar-evidence-sources.test.tsx
artifacts/campaign-workspace/src/__tests__/webinar-guard.test.ts
artifacts/campaign-workspace/src/__tests__/webinar-save.test.ts
artifacts/campaign-workspace/src/components/webinar-workspace/evidence.tsx
artifacts/campaign-workspace/src/components/webinar-workspace/recruitment.tsx
artifacts/campaign-workspace/src/components/webinar-workspace/setup.tsx
artifacts/campaign-workspace/src/components/webinar-workspace/status.tsx
artifacts/campaign-workspace/src/lib/webinar-workspace/adapters.ts
artifacts/campaign-workspace/src/lib/webinar-workspace/navigation-guard.ts
artifacts/campaign-workspace/src/lib/webinar-workspace/rule-routes.ts
artifacts/campaign-workspace/src/pages/campaigns/WebinarWorkspace.tsx
artifacts/campaign-workspace/tsconfig.test.json
docs/verification/phase-2b-6-webinar-setup-recruitment-ui.md
lib/api-zod/src/generated/types/webinarApiEvidenceListAvailableSourcesItem.ts
lib/api-zod/src/generated/types/webinarApiEvidenceListAvailableSourcesItemSourceType.ts
lib/api-zod/src/generated/types/webinarDateImpact.ts
lib/api-zod/src/generated/types/webinarDateImpactEvent.ts
lib/api-zod/src/generated/types/webinarDateImpactInput.ts
lib/api-zod/src/generated/types/webinarDateImpactTouch.ts
lib/api-zod/src/generated/types/webinarDateImpactTouchState.ts
lib/api-zod/src/generated/types/webinarDateImpactTouchTiming.ts
```

**Classification:** the scoped Setup/Recruitment implementation and reported code gates pass, with the browser scenarios in §6 substantively exercised. **Phase 2B-6 is not classified as unqualified complete**: positive exception viewing, actual historical execution, cancellation transition, full manual screen-reader/contrast review, browser reduced-motion emulation, measured skeleton layout stability, and exhaustive negative/regression browser permutations remain unproven or unavailable under the accepted contracts. Axe's three incomplete categories are not successes or proven violations. Do not certify WCAG 2.2 AA or operational readiness. Under the user's physical-commit policy this remains **provisional evidence until all required gates are actually resolved**; the owning agent must decide any further verification and validate final diff/commit.

**Explicit exclusions preserved:** Follow-up implementation, full Readiness workflow, live Foundation connection, real customer or participant ingestion, operational attendance/send/publish/deploy, trusted reviewer approval, local recalculation of governed output or canonical 106 rules, parallel persistence, new schema/migration, broad auth redesign, and unsupported synthetic values treated as operational. No Phase 2B-7 work begins here. External Foundation smoke test remains **NOT RUN because no approved endpoint exists**, not a passing connector test.