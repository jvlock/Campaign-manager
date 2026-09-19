---
name: Foundation taxonomy identity
description: Source identity, repeated tag codes, and partial production-taxonomy imports.
---

Treat the full supplied stable key as source identity within a taxonomy version. A tag code alone is not identity; preserve it separately as the emitted UTM segment.

**Why:** The real Foundation data deliberately reuses campaign tags across product lines, subcampaign tags across campaigns, and even tags across categories. Deduplicating by tag loses valid business branches.

**How to apply:** Resolve parent relationships by full stable key or term ID. Bare tag lookup must use the selected parent or reject ambiguity, never take the first match. Future partial imports must preserve sourced rows absent from the supplied subset and must not manufacture missing rows.

User-supplied production provenance does not itself create a local governance approval.

**Why:** The user supplied verified source rows, not approval actors or approval decisions. Source verification and this application's approval gate are distinct.

**How to apply:** Preserve source attribution, keep stable identities on replay, and use the explicit approval workflow rather than adding synthetic approvals to make UTM generation pass.