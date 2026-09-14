---
name: Planning audit semantics
description: Rationale for scheduling override and audit attribution boundaries in the campaign workspace.
---

An anchor recomputation clears an earlier manual send override, retaining that override and the explanation in history rather than allowing an old override to silently win.

**Why:** This workspace is a planning system. When an event moves, the user specifically expects derived sends to follow their relative rules, while the original calculated value remains an audit fact. A stale override would contradict that expectation.

**How to apply:** Keep initial calculation, current rule result, and manual adjustment distinct. Surface the override-clearing policy when recomputing. Never rewrite the first calculation to make corrected demo data appear originally correct.

Governance actor values are declared attribution until managed authentication exists, not verified identities.

**Why:** Authentication was not part of this refinement and the prior authentication follow-up was cancelled. Recording an actor is useful but must not imply identity verification or access control.

**How to apply:** Label declared attribution accurately. If authentication is later added, derive actors from the session and enforce governance roles rather than trusting submitted actor text.