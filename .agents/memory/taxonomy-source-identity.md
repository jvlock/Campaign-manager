---
name: Foundation taxonomy identity
description: Source identity, repeated tag codes, and partial production-taxonomy imports.
---

Treat the full supplied stable key as source identity within a taxonomy version. A tag code alone is not identity; preserve it separately as the emitted UTM segment.

**Why:** The real Foundation data deliberately reuses campaign tags across product lines, subcampaign tags across campaigns, and even tags across categories. Deduplicating by tag loses valid business branches.

**How to apply:** Resolve parent relationships by full stable key or term ID. Bare tag lookup must use the selected parent or reject ambiguity, never take the first match. Future partial imports must preserve sourced rows absent from the supplied subset and must not manufacture missing rows.

Foundation taxonomy is quarantined, not verified production data. Keep all 7 product lines, 51 shortcodes, and 40 subcampaigns while marking them development/provisional, publishing-ineligible, and requiring business validation.

**Why:** On 2026-09-20 the user reported an unresolved security defect and unvalidated production data in the source system, superseding the earlier production-provenance assumption.

**How to apply:** Preserve stable identities and attribution "Campaign Governance Foundation, migrated via audit". Draft generation remains allowed, including the migrated activity/channel catalogs, but every output must be explicitly provisional. Reject final/official identifier issuance, taxonomy/campaign governance approval, and external publishing regardless of taxonomy validation. No local official fallback; source remediation and explicit future authorization are required before reconsidering this boundary.