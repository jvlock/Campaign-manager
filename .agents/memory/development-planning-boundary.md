---
name: Isolated open development planning
description: Owner-approved sequencing separates open synthetic planning from trusted operational access.
---

Open planning does not require a chosen identity provider, but it must use an explicitly enabled, isolated synthetic database. Never restore usability by exposing unresolved legacy or shared operational data.

**Why:** The owner superseded the earlier authentication-first sequencing after it blocked the development planning experience. This did not relax live sending, publishing, real approval, Foundation authority or operational-readiness controls.

**How to apply:** Preserve the restricted authorization implementation and keep unverified development attribution and simulations out of operational evidence. Treat provider selection as deferred until restricted activation, not a prerequisite to synthetic planning. Verify actual isolation and explicit server mode before exposing planning routes.

The owner explicitly accepted isolated open planning as the correct “open initially, lock down later” approach, but only as a bounded increment. The owner has since **clarified that Phase 2B-1 is complete** as the bounded persistence, audit, retention and concurrency foundation; domain adapters and evaluation orchestration are **Phase 2B-2**, and Foundation connectivity, APIs, trusted auth, remaining UI and external integration are later increments. This supersedes the older full-phase classification in the historical completion report without altering that report or implying full integration is complete. See `docs/verification/phase-2b-phase-classification.md`.

**Why:** Usable planning and simulated persistence do not supply authenticated evidence, governed sources, or operational readiness.

**How to apply:** Classify completion by the owner's clarified increments, not by retroactively claiming all integration work in the foundation. Preserve later adapter/API boundaries and distinguish development simulations from operational authority.

When loading canonical webinar standards during a bundled or relocated development simulation, resolve the workspace root explicitly from the application workspace before reading the catalog and capturing release provenance. Do not derive the catalog path from a source-relative `import.meta` location: a relocated ESM service bundle changes that location and can fail at runtime even when source tests pass.

**Why:** A browser simulation initially returned 503 because the bundle-relative catalog path did not point at the repository standards; explicit workspace-root resolution corrected the boundary without changing canonical files.

**How to apply:** Pass the explicitly resolved workspace root to catalog loading; use that same root-resolution helper inside release capture. Retain a relocated-service-bundle regression alongside source-level tests. Fail explicitly if the workspace marker or canonical files are missing rather than silently falling back to an alternate catalog.

Phase 2B-3 expressly permits **narrow synthetic participant fixtures** for registration, waitlist, cancellation, attendance and suppression simulation in the isolated development database. This supersedes Phase 2B-2's *then-current implementation boundary* of not loading any participant rows; it does **not** permit real customer PII, production imports, provider integration or operational authorization. Fixture keys generate stable IDs and reserved `.test` display addresses, with explicit synthetic/provenance markers and scoped history. The `customer` audience class on a fixture is still synthetic, not a real customer identity. Existing domain audience-branch scoping is not authenticated group membership.

**How to apply:** Require exact new-synthetic occurrence eligibility, a fixture marker and provenance, closed input fields and a private synthetic database before lifecycle evaluation. Keep missing governed observations unavailable, all suppression handoffs disallowed, and snapshots simulation-only. Keep restricted-mode policy separate and do not generalize this exception into a participant import or customer administration interface. See `docs/verification/phase-2b-3-participant-lifecycle-and-suppression.md`.