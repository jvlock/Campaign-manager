# Phase 2B-0B — Marketing group hierarchy impact and plan reconciliation

## 1. Scope, authority and implementation hold

This is a documentation and repository-verification increment only. Campaign Manager
is **not part of the Stellaris portfolio**. No portfolio affiliation, shared tenancy,
identity integration or data access should be inferred from that separate name.

Phase 2B-0A remains accepted. Its historical authorization to begin Phase 2B-1 remains
recorded, unchanged. **The current instruction places the start of Phase 2B-1 on hold
pending review of this reconciliation.** Completing this document or passing its
verification gates does not lift that hold.

Binding references, read for this assessment:

- [Phase 2B-0 integration assessment](phase-2b-0-integration-assessment.md):
  model inventory, source/evidence boundaries, migrations and section 16 implementation sequence.
- [Phase 2B-0A acceptance and owner decisions](phase-2b-0a-acceptance-and-owner-decisions.md):
  all five decisions, concurrent-execution requirements and verification process.
- `docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md`,
  the canonical webinar standard/catalog and existing Phase 2A verification records.
- `replit.md` architecture: campaign/global-regional inheritance is domain metadata.
- `docs/activity-model.md`, `docs/deliverables.md`, database schema and migrations
  `0001`–`0021`, as inspected through the existing assessments and focused source review.

Repository searches found no separate Phase 2B-1 instruction/implementation-plan artifact
and no Phase 2B-1 implementation changes. Section 16 of Phase 2B-0 is the existing plan
being reconciled, not a competing plan to discard. Its increment numbers are retained.
General `replit.md` development `db push` guidance does not supersede the specific
webinar requirement for explicit migrations, isolated verification and rollback plans.

All accepted decisions remain binding: neutral variant concept approval (not draft-copy
approval), Foundation authority/provenance and fail-closed readiness, the six roles and
separation of duties, differentiated retention, and unchanged active legacy sessions.
Request-local diagnostics, exact release fingerprints, complete deterministic populations,
concurrent-request isolation and all 106 canonical evaluator IDs are unchanged.

## 2. Verified repository state and lineage

| Item | Observed state |
|---|---|
| Branch | `feature/webinar-standard-engine` |
| Accepted Phase 2B-0A commit | `0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f` |
| Starting HEAD | `505cc189707846571ce5b46490dfcf2a65d39f3f` |
| Direct parent | `0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f` |
| Tracked working tree / index at start | Clean |
| Untracked files at start | Only `attached_assets/Pasted-This-gives-us-the-checkpoint-we-needed-Based-on-Replit-_1790204703178.txt` |

The accepted commit is an ancestor of HEAD (`git merge-base --is-ancestor`, exit 0).
Exactly one subsequent commit exists:

| Property | Value |
|---|---|
| Full hash | `505cc189707846571ce5b46490dfcf2a65d39f3f` |
| Direct parent | `0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f` |
| Title | Add phase 2B completion notes |
| Authoring / commit timestamps | `2026-09-23T22:58:50Z` / `2026-09-23T22:58:50Z` |
| Every changed file | Added `attached_assets/Pasted-Phase-2B-0-is-substantively-complete-but-one-acceptance_1790204043576.txt` |
| Classification | Archive of the already supplied Phase 2B-0A instruction; not new requirements or implementation |
| Disposition | Tracked, unsuperseded; preserve without alteration |

Its full content is the prior owner instruction already executed in Phase 2B-0A.
The accepted reports, requirements/decisions and verification evidence were not changed.
The commit title alone is not used to infer its contents. This movement does not trigger
the stop condition: no implementation or competing requirement change was found.
No history is rewritten and no upload is staged by this increment.

## 3. Existing structures and reuse boundaries

Paths below are exact repository locations; proposed entities later in this document
are conceptual, not instructions to create parallel tables.

| Surface | Current source and behavior | Reuse / gap |
|---|---|---|
| Organization, team, group, workspace, membership | No such persisted access model in `lib/db/src/schema/` | Missing; the named Campaign Operating Workspace is the application, not a group workspace entity |
| Users | `lib/db/src/schema/campaign.ts`: UUID, name, unique email, free-text `role` | Reuse user identity references after verified authentication binding; neither email matching nor existing role text proves identity or scoped permission |
| Campaigns | Same file: `parent_id`, owner text, scope/region/audience, lifecycle, timing text, row version; `campaign_strategy` inheritance JSON | Reuse stable campaign ID and version checks; parent relation is global/regional campaign metadata, not team hierarchy or an authorization grant |
| Activities | Same file: campaign ID, owner text, governed activity fields, `(id,campaign_id)` unique identity | Reuse canonical activity, not a copied group activity; no group owner or authenticated accountable-person FK currently exists |
| Tasks and drafts | `lib/db/src/schema/activity-task.ts`: activity tasks/settings, textual requesting team, requester, owner/supporting owner and owner capacities; campaign lifecycle/communication configuration hold planning state | Reuse activity children and draft data; task team labels are not group IDs, and text timing is not a normalized calendar date |
| Sessions and participants | `lib/db/src/schema/webinar.ts`: campaign/activity-scoped sessions, stored template version; synthetic people, registrations and attendance | Session remains occurrence under Activity; synthetic people are not users, staff membership or CRM contacts |
| Communications and content | `campaign.ts`, `communication-details.ts`, `deliverables.ts`, `webinar-standard.ts` under schema | Reuse communication IDs, one-to-one details, assets/pages/CTAs and joins; campaign-safe links do not provide access control; no new universal deliverable store needed |
| Schedule sources | `lib/db/src/schema/planning.ts`, `webinar.ts`, `webinar-standard.ts`: session local date/time/timezone, rule/instance/history and standard schedule links | Reuse calculated/original/adjusted times and source identities; no authorized consolidated calendar entity/API exists |
| Budgets | `campaign.ts`: campaign-scoped budget ID, amount, currency, status | Reuse campaign totals once per budget ID; no activity actual-cost/allocation ledger or consolidated-cost service was found |
| Audit and ownership | `campaign.ts` change log, `governance.ts` audit, schedule/trigger histories | Reuse references/patterns, not declared actor text as authentication; ownership/membership decision history is missing |
| API reads/writes | `artifacts/api-server/src/routes/campaigns.ts`: `/campaigns`, `/campaigns/:id`, `/portfolio`, `/conflicts/run`, exports; delivery/webinar/planning routes alongside it | Current list/portfolio reads are global; row-version and campaign-integrity checks are not organizational authorization |
| Calendar-adjacent UI | `artifacts/campaign-workspace/src/components/map/WebinarStandardPanel.tsx`, `WebinarSetupDialog.tsx`; API `src/lib/webinar-standard.ts` schedule calculations | Reuse displays/source adapters later; no dedicated parent-team calendar or group workspace access layer found |

`campaigns.parent_id`, audience branches, `campaign_regions`, activity graph connections,
taxonomy terms and task `requesting_team` must not be repurposed as organization ownership.
The approved Campaign → optional Journey → Activity → Communication/Touch → Deliverable
hierarchy remains intact. No Journey entity is added by this organizational proposal.

## 4. Requirement-to-model reconciliation

The following new stable requirement IDs are outside the canonical webinar registry.
They are assessment/acceptance references only; none becomes a `WEB-*` evaluator.
Existing canonical and prior plan IDs retain their meanings.

| New ID | Requirement | Current classification | Recommendation |
|---|---|---|---|
| `CM-ORG-001` | Parent marketing team with child groups; two initial levels | Missing | Add organizational identities and explicit parent relation, not campaign parentage |
| `CM-ORG-002` | One or more members and separate workspace per active group | Missing | Group-scoped logical workspace over existing records; activate only with verified membership |
| `CM-ORG-003` | People can belong to multiple groups | Missing | Many-to-many, revocable memberships with verified principal references |
| `CM-ORG-004` | Group campaigns, activities, tasks, drafts and calendar | Partially supported | Reuse existing records; add authoritative organizational ownership/access resolution |
| `CM-ORG-005` | Authorized parent calendar without copying activities | Missing | Authorized projection and explicit summary/detail grants |
| `CM-ORG-006` | Stable group identity through rename/reorganization | Missing | Immutable opaque ID, separate mutable label and audited parent changes |
| `CM-ORG-007` | Cross-group collaboration without duplicate activity/cost | Partially supported | Existing activity identity plus explicit campaign participation and record grants |
| `CM-ORG-008` | Archive groups, retain history | Missing | Archive status, no cascading deletion, explicit historical access |
| `CM-ORG-009` | Organizational ownership independent of product/geography/audience/classification | Conflicting if existing fields are reused | Preserve domain classifications; introduce independent organizational references |
| `CM-ORG-010` | Actions separate from group scope; server-side isolation | Missing | Extend accepted roles with verified scoped grants; no hierarchy-derived privilege |
| `CM-ORG-011` | Verified legacy ownership without standard migration | Missing | External ownership/access associations; unresolved quarantine |
| `CM-ORG-012` | Complete deterministic calendar/population results, unique totals | Partially supported | Reuse schedule sources; add explicit query, pagination and deduplication contract |
| `CM-ORG-013` | More than two organizational levels | Deferred | Stable parent references allow later reviewed depth extension; no recursive privilege inheritance now |
| `CM-ORG-014` | Future activation/nurture/events/sales references | Partially supported | Reuse Activity and approved-content references; defer module and CRM implementation |

“Conflicting if reused” is a warning about an unsafe mapping, not a claim that the
current application already implements a contradictory group hierarchy.

## 5. Proposed ownership and membership foundation

### 5.1 Minimal entities and identities

Recommend a single organizational-unit identity model with `team`/`group` kinds and a
parent reference: initially a root parent team and its child groups only. This avoids
two parallel organization trees. A separately normalized team/group representation is
also viable, but the decision must be made in the approved ERD before migrations.
IDs are immutable; names/slugs are not foreign keys or authorization keys.

Treat a group workspace initially as a **logical scope**, not a second campaign store
or separate database. Add a one-to-one workspace settings entity only if independent
settings actually require persistence. Active groups require at least one verified
member. If the last member leaves, revoke that member immediately and place the group
in a restricted/unstaffed state; do not preserve access merely to satisfy cardinality.
Archive and controlled stewardship are separate from ordinary membership.

Reuse existing `users.id` where safely bound to an authenticated subject; any external
subject binding must be verified, unique and auditable, never inferred from owner text
or a supplied reviewer name. Do not use webinar participant records as staff identities.

Membership establishes scope and has effective/revoked state and provenance. Scoped
role assignments establish actions. They can share implementation infrastructure but
must remain semantically distinct. A Planner grant for group A plus membership in B
does **not** automatically make the person a Planner for B.

### 5.2 Single ownership resolution

Use authoritative campaign-ownership and activity-ownership associations keyed by the
existing campaign/activity ID. These associations can cover both old and new records,
avoiding independent legacy and new ownership sources. New records require verified
ownership in their creation transaction. Existing unresolved records remain explicitly
unresolved rather than receiving invented ownership.

Each resolved campaign has one owning group. Each resolved activity has one owning
group. An activity defaults to its campaign group at creation; it does not silently
change owner whenever the campaign is transferred. Maintain a campaign-participation
relation containing the campaign owner and explicitly admitted collaborator groups.
An activity owner must be an active authorized participant in that campaign.

This permits one campaign owned by group A to coordinate an activity owned by B,
without copying the activity or claiming that every child must have the same owner.
Same-campaign FKs remain mandatory. A composite reference from
`(campaign_id, owning_group_id)` to approved campaign participation can enforce the
allowed-owner invariant; cross-parent-team collaboration is denied until separately
approved. Participation is **not** blanket access to all sibling activities.

Keep four concepts distinct:

| Concept | Source and meaning |
|---|---|
| Creator | Authenticated subject at creation, immutable attribution; not permanent ownership or permission |
| Accountable person | Explicit, changeable operational responsibility; does not confer a role |
| Owning group | Single organizational custodian resolved from the authoritative association |
| Collaborating groups | Explicit participants/grantees with limited actions on defined resources; not co-owners |

### 5.3 Child and shared-resource scope

- Sessions, communications, communication details, registrations/attendance, activity
  tasks, and their schedule/history records resolve scope through their one Activity.
  Do not add separately editable group IDs to each child.
- Campaign-level strategy, drafts, budgets and resources without an Activity resolve
  to the campaign owner and explicit resource grants. Activity drafts inherit Activity.
- Assets/pages/CTAs already reusable across communications keep one resource identity
  and one resolved custodian. Linking a resource does not reveal its restricted content
  or grant edit rights; consumer use/reference permission and content-detail permission
  must be checked separately. A campaign-owned resource is not re-owned by a consumer.
- Group-level drafts/tasks not attached to a campaign or Activity are not currently a
  distinct product requirement. Defer a free-floating work-item model rather than
  inventing parallel task/draft stores.
- Exception and evidence scope includes the affected campaign/Activity/occurrence and
  original finding/content identity. Cross-group collaboration never broadens review
  authority by implication.

### 5.4 Transfers, removal and archival

Transfers must be explicit, authorized by an approved source/destination process and
atomic with ownership/participation revision and audit. Report affected descendants,
collaborations and access before approval. Preserve record IDs, creator, past owners
and historical evidence. Re-evaluate current grants/caches; never silently grant the
destination group access to unrelated campaign children or rewrite past approvals.

Membership removal revokes access unless a different valid grant remains. Check current
membership/authorization revisions at read, mutation commit and job execution/delivery.
An old session token or queued job is not proof of current permission. Cancel/reject
stale work; already disclosed data cannot be technically recalled.

Archive blocks new ordinary work and new default memberships, retains identity and
records, and uses explicitly authorized read-only historical access. Do not cascade
delete campaigns, audit or evidence. For ongoing work, require a reviewed transfer or
stewardship plan before archival; do not silently migrate legacy sessions or strand them.
Reparenting is an audited organizational change with grant review, not automatic access
inheritance. Future extra levels need cycle/depth validation and reviewed scope semantics,
not a new identity scheme or recursive access expansion.

## 6. Action permissions versus organizational scope

Authorization requires all of: verified identity; valid scoped action grant; authorized
record relationship; applicable readiness/evidence checks; and separation-of-duties
checks. Roles never bypass canonical controls. No public/broad read default is inferred
from the application's existing private access gate.

| Accepted role | Actions within an explicitly granted group/record scope | Parent-team scope and exclusions |
|---|---|---|
| Planner | Create/edit plans, submit evidence | Only explicitly covered child groups/records; no approval or execution from leadership |
| Exception Requester | Request eligible exceptions | Must have record scope; cannot approve own request anywhere |
| Independent Reviewer | Approve/deny eligible exceptions and required evidence | Must have review action plus access to the specific record/evidence; no automatic child access |
| Operations Executor | Authorized actions after readiness and environment requirements | No operational action in the current no-send pilot; hierarchy does not change that |
| Administrator | Access/configuration management within assigned scope | Cannot bypass `WEB-EXC-001`, other non-overridable controls, or readiness; no implicit data-detail grant |
| Read-only Viewer | Inspect explicitly permitted plans/findings/readiness/audit | Summary-calendar access can be narrower than full record/audit viewing; no mutations |

Parent membership alone grants no child-group records. Parent oversight should use
explicit bounded child-group/record grants, not an “all descendants” default that grows
when a group is added. Group leadership is metadata, not an Independent Reviewer role.
Self-approval is checked by the same authenticated person across groups and role changes,
not by comparing role names or current workspace. An approver acting as Requester in A
and Reviewer in B is still the same person.

Enforce the same server-side policy for direct IDs, nested joins, campaign lists, portfolio
counts, search/suggestions, exports, conflicts, background tasks, calendar pages and
download delivery. Apply filters before counts/aggregations; restricted record existence
must not leak through totals, error differences, relationships or search matches.
Current unscoped `/campaigns`, `/portfolio`, `/conflicts/run` and export paths require
coverage before enabling group workspaces; protecting only new routes is insufficient.

Collaborator rights must be resource-specific. A separately owned activity can expose
only approved minimal campaign context to its staff, not all campaign siblings or budgets.
Summary visibility is not permission to edit, review, approve, execute or follow a link
to restricted details. Unverified identity, unresolved ownership or stale membership
fails closed for organizational authorization and operational actions.

## 7. Authorized calendar rollup contract

The master calendar is a read projection over existing activities and linked dates,
not a duplicate calendar database. A future derived cache may exist only with source IDs,
versions and invalidation; it is never an editable date or ownership authority.

| Contract area | Proposed behavior |
|---|---|
| Entry identity | One Activity reference, plus occurrence identity where an Activity genuinely has multiple occurrences; dedupe identical `(activity_id, occurrence_id)` across group grants/views |
| Date authority | Webinar occurrence uses session date/time/IANA zone and canonical schedule adapter. Linked communication timings use effective scheduled instances/standard links once. Non-webinar text timing cannot silently become an instant; show unscheduled until an explicit typed source is defined |
| Communications/milestones | Child markers reference original communication/task/rule/instance IDs, not cloned activities; standard-to-generic links prevent displaying the same schedule twice. Use explicit dated task/milestone semantics, never infer from arbitrary text |
| Changes | Date/status/ownership/cancellation revision invalidates affected projection; move one entry rather than add a copy. Preserve original calculations/history. Cancellation is a visible source state when authorized, not deletion |
| Time zones | Preserve source local date/time and IANA zone; canonical conversion handles DST ambiguities. Query ranges use explicit boundaries and overlap rules; display in selected viewer zone with source zone available. Date-only events stay date-only |
| Status | Separate tentative/draft, approved planning state and live/operational state, each backed by its own evidence. A lifecycle label or scheduled time alone is not proof of live execution or webinar readiness |
| Authorization | Resolve permitted owning/collaborating records server-side before projection, deduplication, pagination and aggregation |
| Filters | Explicit group, date window, type and state filters apply consistently to entries and totals; disclose filter scope, not hidden-group counts |
| Pagination | Stable sort `(start instant/date, activity ID, occurrence ID)` with explicit null handling, cursor and source revision; no silent cap or first-page-only export |
| Completeness | Paged interactive results clearly indicate more pages. Whole-population operations exhaust pages over a consistent snapshot or explicitly fail/restart if it changes. Exports and totals must not silently use a sample |
| Revocation during pagination | Bind cursor/cache to principal, scope and authorization revision; membership changes invalidate the cursor/cache and require reauthorization. Never finish an old snapshot at the expense of revoked access |
| Restricted summary | Default: no sibling/parent summary without an explicit grant. If owner approves limited visibility, allow only reviewed fields (e.g. busy interval and coarse type/status); exclude title, client/audience, people, content links, costs and hidden IDs unless separately authorized |

Shared activities appear once in parent results even when the viewer belongs to several
groups. Genuine separate activities with similar titles/times remain separate; never
dedupe by name. Multiple occurrences may yield several entries but the Activity total
counts distinct activity IDs. Communication/milestone markers do not inflate that total.

Budgets are currently campaign-level planned values, not activity costs. Count each
authorized budget ID once, independently of calendar joins, and group amounts by currency
without inventing exchange rates. Do not sum a campaign budget and its future allocations
as additional spend. Future cross-group allocations would require explicit cost-line
identity, conserved allocation totals and approval; until then, no per-group actual-cost
claims. With restricted detail, omit financial totals unless separately authorized; if
a total is partial, label its permitted/filter scope.

Calendar UI and advanced audience-conflict detection are deferred. Existing global
conflict queries still need authorization containment; deferring advanced detection is
not permission to leak current conflict records.

## 8. Constraints and future migration design

These are design recommendations, not migrations or finalized table names:

1. Immutable organization IDs; validated same-tree team/group parent references;
   no cycles, orphan parents or unsupported third level; active/archived versioned state.
2. Verified subject uniqueness, explicit effective membership and scoped role/grant
   uniqueness; revocation/expiry checks; no nullable “everyone” group grant.
3. One effective verified ownership association per campaign/Activity. New creation
   requires it atomically; unresolved historical records remain explicitly restricted.
   Use typed FKs rather than unchecked polymorphic UUIDs where possible.
4. Composite campaign participation/ownership constraints as described in section 5;
   preserve existing `(id,campaign_id)` constraints and enforce same-Activity child scope.
   Parent unique constraints must precede dependent FKs.
5. Append-only ownership/grant decision history; optimistic ownership/group revisions;
   FK delete restrictions where audit retention applies, not cascade through history.
6. Index active memberships by principal/group, scoped grants by principal/scope/action,
   ownership by group/record, campaign participation by campaign/group, and source
   schedule range plus activity/occurrence IDs. Choose exact range/order indexes from
   the approved query plan; do not assume a nonexistent universal `activities.start_at`.

Recommended migration sequence after hold release and design approval:
add minimal org/membership/grant/association structures → seed only verified groups
and identities → record reviewed ownership mappings and unresolved cases → reconcile
counts and access tests → enforce constraints for verified/new records → enable guarded
reads → enable guarded writes/new creation. Validate upgrade fixtures and existing
legacy paths against all 21 migrations plus future additions. No mandatory historical
NOT NULL backfill may force fabricated ownership.

The existing 0020 unique-before-composite-FK pattern is reusable. The 0021 staged
publish constraint caveat remains unresolved by this document; future migrations need
explicit rehearsal and constraint validation, not an assumption that `db push` is safe.
Minimum authorization design precedes schema-dependent writes; schema installation
alone must not expose unguarded organization data.

## 9. Legacy compatibility and recovery

An organizational access association is not a webinar standard migration. The proposed
association resolves access outside legacy operational records. Do not mutate legacy
template versions, communications, schedules, participants, evidence or historical
fingerprints merely to associate a group.

Verified mapping process:

1. Inventory candidate campaign/activity IDs and existing parent/child links read-only.
2. Collect authoritative ownership evidence from responsible owners/approved sources;
   creator labels alone are insufficient. Record evidence reference and conflicts.
3. Have authorized reviewers confirm group, campaign participation and effective scope;
   record verifier, source, status, effective time and mapping revision.
4. Dry-run proposed access, reconcile all descendants, and report unresolved/contradictory
   mappings. Resolve conflicts explicitly; never assign everything to an arbitrary group.
5. Apply only confirmed side associations in a reversible, audited transaction.
   Unresolved records remain in a restricted stewardship queue with no group exposure;
   temporary steward access, if needed, must be separately approved and scoped.
6. Prove before/after legacy payload and fingerprint equality plus unchanged planner
   routing for `legacy_9` and `default_5` through completion.

Keep current authorization context separate from the immutable engine/evidence snapshot.
New access-decision audit may reference old evidence by stable ID/hash; it must not
recalculate or rewrite historical evidence fingerprints. If existing code cannot provide
this separation without changing legacy behavior, stop for review rather than introduce
an undocumented legacy exception.

New sessions require verified owning Activity/campaign participation and authenticated
creation, but use the new standard only after the already-authorized pilot cutover
conditions are met. Organizational rollout is not that cutover.

Recovery: retain mapping before-state and immutable history; disable new workspace
exposure if validation fails; revoke mistaken grants and restore a verified prior
association through compensating records. Do not restore unguarded global access as
a rollback shortcut, delete retained evidence, reset history or rewrite legacy sessions.
Rehearse additive migration rollback with isolated fixtures and legal-hold constraints.

## 10. Security, retention and concurrency implications

Use request-local subject, authorized scope and completion diagnostics; never process-global
“current group” or last-result state. Cache keys include principal/scope, authorization
revision, source version and release identity. Jobs use explicit verified service/user
scope, recheck it at execution/delivery, and never inherit another request's context.
Transfers, archival and grant revocation require atomic revisions/cache invalidation
and race tests, not just UI refreshes.

Preserve exact standard/evaluator/implementation/governed-dependency release fingerprints.
Organizational authorization revisions are additional audit context, not replacements
for engine identity or modifications to canonical rule IDs. Full populations still
require deterministic, complete results, with no cross-group leakage in diagnostics,
evidence, exceptions or failure messages.

Apply Phase 2B-0A retention unchanged: seven years for the specified approval,
separation-of-duties, release/provenance, operational/suppression and material-decision
snapshot categories; 24 months for recomputable diagnostics not used as decision evidence;
temporary diagnostics only for troubleshooting needs; participant PII follows its
authoritative corporate schedule. Ownership/grant evidence relied upon for a retained
operational decision must retain sufficient non-PII provenance with that decision.
Do not automatically retain every staff directory field for seven years.

Archive is not deletion or revocation policy by itself. Legal holds override deletion;
source PII deletion must not destroy required non-PII audit references. Retention stays
configurable. Staff identity data needs its applicable privacy schedule, not a speculative
new participant/CRM store.

## 11. Future-module compatibility, without implementation

| Future scope | Shared foundation that should suffice | Explicitly deferred |
|---|---|---|
| Content activation | Group-owned Activity plus approved content/version references and use grants | Activation workflow, distribution adapter, duplicate content store |
| Long-term nurture | Stable Activity/campaign ownership and scoped authorization | Journey orchestration, recipient history and new participant databases |
| Display and paid social | Existing Activity/channel/content references within group scope | Ad platform connections, execution, spend ingestion |
| In-person events | Activity/occurrence references and timezone/venue-aware source contract | Event operations and attendee store |
| Conference participation | Owning Activity, accountable person, shared content use | Conference-specific planning/product screens |
| Campaign/person-specific sales enablement | Authorized Activity and approved-content reference; minimal durable authoritative CRM identifiers if later approved | CRM duplication, contact/profile store, sales permissions or connector implementation |

Governed classification still comes from Foundation. Group membership must not change
product, region or intended audience taxonomy. Authorization to see an Activity does
not automatically authorize any referenced CRM person or restricted content.

## 12. Unresolved owner decisions and restricted defaults

These are genuinely new organizational choices, not requests to reapprove the five
Phase 2B-0A decisions. Defaults are recommendations pending review, not granted access.

| Decision | Options and effect | Recommended default / affected work |
|---|---|---|
| `CM-ORG-D01` Parent and sibling visibility, including drafts | No visibility; busy-only summary; selected detail. Wider choices reveal planning/confidential information | No inherited visibility, drafts owner-only; explicit record/group grants. Before access/calendar schema and API contracts |
| `CM-ORG-D02` Who grants/revokes membership and scoped roles? | Scoped administrators; central directory authority; approved combination | Verified scoped Administrator, audited grants, no action privilege from leadership; identity source/trust must be selected before authorization rollout |
| `CM-ORG-D03` Cross-group campaign and resource collaboration | Activity-specific grants vs campaign-wide access; same parent vs cross-parent | Same-parent explicit participation and least-privilege activity/resource grants; deny cross-parent collaboration initially. Before ownership/participation constraints |
| `CM-ORG-D04` Ownership transfer, archive and unresolved stewardship | Source/destination approval and narrow steward access vs broader parent control | Explicit source/destination approval, narrow time-limited stewardship, block silent active-work archive. Before mapping/transfer migration workflow |
| `CM-ORG-D05` Calendar summary and financial visibility | No summary; reviewed busy fields; approved detailed/budget view | No restricted summary/costs unless separately granted; distinct budgets/currencies only, no invented allocation. Before rollup contract exposure |
| `CM-ORG-D06` Initial group roster and verified historical mapping authority | Owner-attested records or authoritative organizational source | Verified roster/mapping with recorded evidence and conflict queue; never arbitrary defaults. Before historical backfill and group activation |

More than two levels, free-floating workspace items, advanced cost allocation and
calendar UI remain deferred; they need not block the minimum reviewed foundation.
No question here permits self-approval, administrator bypass or unverified identities.

## 13. Reconciled sequence — changes to the existing plan

This is a proposed sequence for review, **not implementation authorization**.
Phase 2B-0 section 16 remains the source plan; its stable increment numbers are retained.
The supplemental design gates below do not enter the evaluator registry.

| Reconciliation change | What remains unchanged | Must precede affected DB work | Within existing phase after approval | Deferred / owner decision |
|---|---|---|---|---|
| `CM-ORG-P01`: extend Increment 1 ERD and source boundaries | Exact standard binding, evidence/history boundary, accepted retention | D01–D06 decisions relevant to schema; org/identity/ownership/grant ERD; legacy mapping contract | Design the minimal two-level association model and policy matrix | Additional levels, enterprise IAM/SCIM; reviewer approval of this reconciliation first |
| `CM-ORG-P02`: extend Increment 2 migration foundation | Nullable-first, scoped FKs, all 21 migration compatibility, no fabricated legacy facts | Approved P01, chosen source identity binding, ownership invariants and rollback | Add minimum organization/membership/scoped-grant/ownership persistence with webinar foundations when justified | No arbitrary ownership backfill or duplicate workspace data store; D03/D04/D06 |
| `CM-ORG-P03`: extend Increment 2A authorization | The same six roles, independent review, no bypass | Authorization contract in P01 before schema choices; P02 persistence before runtime writes | Shared server-side action + group/record checks, including existing reads/search/exports/conflicts and jobs | No broad parent privilege, operational sending or enterprise directory rollout; D01/D02 |
| `CM-ORG-P04`: extend Increments 3–4 adapters/orchestration | Request-local results, release fingerprint, complete population, legacy routing | Ownership resolution and policy-aware query design | Resolve authorized sources without changing domain policy; preserve all participant findings and cache isolation | No new canonical rules; no inferred source data |
| `CM-ORG-P05`: apply to Increments 5–9 mutation/observation APIs | Existing state, suppression, Foundation and exception requirements; 8 before integrated 7 | P02/P03 plus canonical dependencies | Authorize current record scope and original review identity at every transaction/ingestion boundary | New connectors/modules beyond existing approved boundaries; no sending |
| `CM-ORG-P06`: add calendar read contract and future workspace presentation | Existing source dates/IDs, no-send terminology, distinct readiness stages | Reviewed D01/D05, source/date and pagination contract; no calendar-copy schema | Only minimal source/reference constraints required by approved foundation; specify API behavior in design | Calendar/group UI and advanced conflict detection later; do not add to current DB scope silently |
| `CM-ORG-P07`: strengthen Increments 12–14 compatibility/release gates | Existing legacy non-regression, exports, retention, UX/release review | Mapping/rollback fixtures before any backfill; no legacy rewrite | Ownership/grant race, leak, unique-total and revocation scenarios alongside existing gates | Deployment/cutover separately authorized; no implementation now |

Dependency order after review: **P01 approval → Increment 2/P02 additive persistence →
Increment 2A/P03 guarded access → Increments 3–4/P04 → existing 5, 6, 8, 7, 9 sequence →
later UI/export/verification increments**. Authorization design starts before migrations,
while runtime guard enforcement waits for its minimal persistence. Do not create a
circular requirement that operational access must exist before its schema, or expose
new data unguarded between these steps.

Legacy and isolation checks apply throughout, not only at Increment 12. Calendar
presentation can remain deferred without blocking minimal group-aware ownership design.
If an affected owner decision remains unresolved, stop that design/backfill/exposure
boundary rather than adopting permissive defaults.

## 14. Acceptance-test scenarios for future implementation

These are proposed tests, **not implemented or passed hierarchy tests**:

1. `CM-ORG-001/006/013`: two-level creation works; third level/cycle/orphan rejected;
   rename retains IDs; reparent reviews grants without exposing new descendants.
2. `CM-ORG-002/003/010`: same person belongs to A and B; Planner in A cannot edit B
   merely through membership; removal revokes A even with a stale token.
3. `CM-ORG-010`: parent leader sees no ungranted child records; administrator cannot
   bypass canonical controls; same person cannot request in A and approve in B.
4. `CM-ORG-004/007`: campaign A coordinates B-owned activity with explicit participation;
   invalid campaign/group attachment fails atomically; collaborators see no sibling drafts.
5. `CM-ORG-005/012`: multi-membership and shared activity yield one occurrence entry;
   multiple legitimate occurrences remain distinct; activity/budget totals do not multiply.
6. `CM-ORG-012`: reschedule, cancellation, DST transition, viewer zone and date-only events
   preserve source dates/history; untyped timing remains unscheduled.
7. `CM-ORG-010/012`: direct IDs, search, suggestions, exports, conflict results, counts
   and background jobs cannot reveal restricted records, titles, totals or diagnostics.
8. `CM-ORG-012`: more records than a page/cap still export completely and deterministically;
   mutation/revocation during paging invalidates the cursor instead of leaking or truncating.
9. `CM-ORG-008/011`: archived/unresolved groups preserve history but cannot receive ordinary
   new work; last-member removal restricts group without preventing revocation.
10. `CM-ORG-011`: verified side associations leave both legacy templates' session payload,
    schedules, evidence and fingerprints byte-identical; mapping rollback preserves audit.
11. `CM-ORG-010`: concurrent cross-group evaluations/transfers/reviews cannot mix subject,
    evidence, exceptions, diagnostics or stale ownership; revoked queued work is denied.
12. `CM-ORG-007/014`: content reference/use permission does not expose restricted content
    or CRM details; one shared approved asset does not imply one shared message variant.
13. Retention/hold: archive or PII deletion preserves required non-PII decision evidence;
    legal hold defeats expiry; temporary diagnostics do not become permanent PII storage.
14. Upgrade/rollback: clean and existing fixtures validate current 21 migrations plus
    approved future additions; inconsistent ownership/quarantine never falls back to
    unauthenticated global access; all canonical webinar tests remain intact.

## 15. Verification and commit evidence

All checks below were freshly run for this increment after document creation. The
preceding Phase 2B-0A results remain historical evidence; they are not substituted for
these measurements. No new hierarchy test has been implemented; section 14 is a future
acceptance specification.

### 15.1 Commands and test accounting

```sh
git merge-base --is-ancestor 0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f HEAD
git log --reverse --format='%H%n%P%n%s%n%aI%n%cI' --name-status 0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f..HEAD
node artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs --check
pnpm --filter @workspace/api-server run typecheck --incremental false
pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*/*.test.ts'
node lib/db/test/disposable-db.mjs -- pnpm --filter @workspace/api-server exec tsx --test --test-reporter=tap --test-concurrency=1 './test/*.test.ts'
node --test --test-reporter=tap artifacts/campaign-workspace/scripts/resize-observer.test.mjs
```

| Suite | Files | Top-level records | Nested subtests | Total TAP records | Grouping records | Leaf tests |
|---|---:|---:|---:|---:|---:|---:|
| Complete domain suite | 35 | 3,081 | 7 | 3,088 | 1 | 3,087 |
| Complete API suite | 14 | 69 | 0 | 69 | 0 | 69 |
| Frontend regression | 1 | 2 | 0 | 2 | 0 | 2 |
| **Total** | **50** | **3,152** | **7** | **3,159** | **1** | **3,158** |

All suite/typecheck/drift commands exited 0. Failures, skips, cancellations, TODOs,
setup failures, teardown failures and type errors were each **zero**. The single parent
grouping record is included among top-level/TAP records and removed for leaf accounting.
Counts match the prior record because sources/tests are unchanged, not because counts
were forced. The domain run includes catalog, evaluator, exception, evidence, readiness,
scheduling, audience and completion suites. The two frontend regressions are the existing
ResizeObserver tests, not new group/calendar UI or browser acceptance tests.

### 15.2 Disposable migrations and cleanup

Fresh API verification used the existing disposable-database harness and its pre-0001
foundation fixture. All **21 existing migrations**, `0001_delivery.sql` through
`0021_stage_one_deliverable_publish.sql`, individually reported successful
`migration-applied`; their unchanged complete inventory is in Phase 2B-0A section 7.2.
No new migration was created or applied to the application/production database.

Verifier: `allMigrations:true`, `migrationCount:21`, `after0016Present:true`,
`registration_unique:true`, `scheduled_constraint_named:true`, `taxonomy_active:true`.

Disposable root `/tmp/disposable-pg-id9cHj` cleanup returned `reason:"normal"`,
`postgresStopped:true`, `socketRemoved:true`, `tempRootRemoved:true`.
Independent filesystem inspection confirmed that root no longer existed.
This successful disposable run does not authorize a production schema change.

### 15.3 Canonical and accepted-document integrity

Fresh byte comparisons against accepted baseline
`0d5c990ecbc4e1bf655b4071a13f6eb992dcf33f` passed for all five canonical files and both
accepted reports. SHA-256:

| File | SHA-256 |
|---|---|
| `docs/standards/webinar/WEB-STANDARD-001.rules.json` | `7abe547acf36d2f4b61c937f4ae192a3d30db52d5c2c947fd60d2c82b3c4f2e2` |
| `docs/standards/webinar/WEB-STANDARD-001.md` | `74d10b56c625db6ae203a5fe097f4586611650ff15e4882479d78a98f62ebf25` |
| `docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md` | `87b0f5a4eefe5b52e516db16d1483d6e4025e5b54a658e3132f0267d3800a09f` |
| `docs/standards/webinar/CHANGELOG-RC1.md` | `b67a40ca7ad4a3be35d510c5b4eb1d0e29577d7471a1b05862697e53b5ddba0c` |
| `docs/standards/webinar/manifest.json` | `8a4268ff7c8ff82d747defae8549f5cd845ec1c4c91cdec27f0e641bb66d0859` |
| `docs/verification/phase-2b-0-integration-assessment.md` | `cb6dde4a0007d59e9a5c6280723c0dbed3445288ee08477eb9c57649bc738d30` |
| `docs/verification/phase-2b-0a-acceptance-and-owner-decisions.md` | `96dbee0d0b0250c7206277f2cfce56f52be9db6b986414ef25e1af7e6c1cdea9` |

Rule-ID drift returned `RULE_IDS_OK: check; 106 rules`. Runtime inspection through
`pnpm --filter @workspace/api-server exec tsx --input-type=module -e`, importing the
existing catalog/registry test fixtures and comparing IDs bidirectionally, returned:

```json
{"canonical":106,"implemented":106,"missing":[],"unknown":[],"duplicate":0}
```

The manifest and lockfile importer specifier/resolved version retain exactly
`@js-temporal/polyfill` **0.5.1**. Source diffs confirm the generated IDs, evaluator
registry and dependencies were not modified.

### 15.4 Exact scope and interpretation

Before staging, the tracked diff against starting HEAD was empty; only this decision
document and the current instruction upload were untracked. Comparing application,
library, package/configuration and dependency paths against the accepted commit also
produced no differences. Accepted reports and canonical documents are byte-identical.
There are no application, test, schema, migration, route/API, UI, configuration,
dependency or integration changes.

Only this document is allowlist-staged and checked with `git diff --cached --check`;
the commit's actual changed-file list and ending SHA are reported after commit. The
instruction upload is not staged. Temporary runner logs are under `/tmp/phase2b0b/`;
the results above are the durable verification record.

**Assessment documentation and repository verification are complete.** Phase 2B-0A
acceptance remains intact. The hierarchy proposal and new visibility/ownership decisions
require owner review. **Phase 2B-1 remains on hold; no implementation occurred.**

## 16. Delivery boundary

Only this document may be committed, titled
`Assess marketing group hierarchy before webinar integration`. Expected parent is
`505cc189707846571ce5b46490dfcf2a65d39f3f`; any movement must be inspected.
Ending SHA and exact changed-file state are reported after commit.
No application, tests, schema, migrations, API, UI, dependencies, integrations, sending,
publishing or deployment changes are made. Phase 2B-1 remains on hold pending review.