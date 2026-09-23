# Phase 2B-1 — Organizational owner decision record

The owner authorized a **bounded organizational foundation increment**, not completion of the full Phase 2B-1 webinar integration plan or deployment. Authority: `attached_assets/Pasted-The-reported-assessment-supports-adding-the-group-struc_1790205779004.txt`, section 2. This record resolves `CM-ORG-D01`–`CM-ORG-D06` in [the Phase 2B-0B assessment](phase-2b-0b-group-hierarchy-impact-and-plan.md), section 12. Its earlier **recommendations** (including the narrower busy-only calendar recommendation) are superseded where they differ from the decisions below; the original assessment is preserved unchanged. The accepted [Phase 2B-0 integration assessment](phase-2b-0-integration-assessment.md) and [Phase 2B-0A owner decisions](phase-2b-0a-acceptance-and-owner-decisions.md) remain authoritative for webinar controls, retention, legacy sessions, roles and the original section 16 implementation sequence. No canonical evaluator ID is introduced here.

## A. Parent and sibling visibility (`CM-ORG-D01`)

* Each group has a separate workspace.
* Members receive access through explicit, scoped grants.
* Designated parent-team calendar viewers can see planning summaries across explicitly authorized child groups.
* Summary fields include activity title, owning group, accountable owner, activity type, dates, time zone, and planning status.
* Tentative activities are clearly identified. Working drafts remain group-private until explicitly marked for calendar visibility; this does not constitute operational approval.
* Sibling groups receive no automatic access to drafts or detailed records.
* Calendar access does not reveal participant information, internal notes, budgets, evidence, or approval controls.
* Adding or moving a child group must not silently expand existing viewers’ access.

## B. Membership administration (`CM-ORG-D02`)

* Authorized Administrators manage groups, verified memberships, and scoped role grants.
* Group leads may request membership changes but receive no automatic access-administration authority.
* Users cannot approve their own privilege elevation. Initial administrator provisioning must use a documented, trusted bootstrap process.
* Membership and role changes are audited.
* Removing membership removes the access derived from it, including access through cached sessions or background operations, according to a documented revocation mechanism.

## C. Collaboration (`CM-ORG-D03`)

* Each campaign and activity has one owning group.
* A campaign can coordinate activities owned by other groups through explicit relationships.
* A relationship alone grants no access.
* Collaboration grants identify the record, recipient group or user, and permitted actions.
* Collaboration does not automatically grant exception approval, operational execution, access to all child records, or access to participant data.
* Revocation must remove access derived from the collaboration grant.

## D. Ownership transfers and archival (`CM-ORG-D04`)

* Transfers require an authorized Administrator and recorded acceptance by the destination group’s accountable owner.
* Preserve record IDs, governed codes, history, and historical evidence.
* Reassess existing grants during transfer; do not automatically retain obsolete access or expose restricted historical attachments.
* Transfers must not silently rewrite approvals or readiness evidence. Where ownership affects their validity, require reassessment before further operational action.
* An active group must retain an accountable owner.
* Archive a group only after active work is completed or transferred.
* Archived groups retain authorized historical reporting but cannot receive new work.

## E. Calendar and financial summaries (`CM-ORG-D05`)

* Calendar rollups use underlying records and deduplicate by stable activity identity.
* Calendar access and financial access are separate permissions.
* Financial rollups require explicit authorization and must distinguish unavailable amounts from zero.
* Shared costs are counted once according to their documented allocation.
* Financial dashboards and advanced conflict detection are deferred.

## F. Historical ownership (`CM-ORG-D06`)

* Do not infer historical ownership solely from record creator.
* Do not assign all existing records to an arbitrary default group.
* Historical assignments require a verified mapping and audit trail.
* Unresolved records retain their existing authorized handling and are excluded from newly introduced cross-group visibility.
* Active legacy sessions remain unchanged through completion. If associating organizational ownership would alter their behavior or accepted evidence, defer that association.
* Newly created records using the new organizational model require valid ownership.

These decisions authorize design and the bounded foundation only. They do not certify a trusted identity provider, authorize live operation, approve a production migration or reopen any of the five Phase 2B-0A decisions.