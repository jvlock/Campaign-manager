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

For the standard webinar template, calendar-day offsets retain the event's local clock time; 24-hour and 1-hour reminders use elapsed time.

**Why:** The supplied nine-message specification defines days and weekend direction but does not supply a separate invitation/follow-up send time. Retaining the event clock avoids inventing a 09:00 default. Hour-based reminders must remain exact through daylight-saving changes.

**How to apply:** Keep the fixed webinar template distinct from freely editable generic schedule rules. If a separate local send-time policy is later supplied, treat it as a deliberate template change, retaining prior calculations and history.

Changing the default webinar sequence is not permission to convert existing webinars.

**Why:** The user explicitly chose a five-message default for new webinars, with existing webinars left unchanged. Their previous nine-message sequence may already contain approved copy, schedules, and history.

**How to apply:** Resolve behavior from each session's stored template version, including during repairs and reconciliation. Any conversion of existing sessions needs a separate, explicit user request.

Implementation-task stage and blockage must remain independent, including in future imports and rollups.

**Why:** The user specifically rejected Airtable's single Task Status model because it conflates progress with impediments. A blocked task does not lose its stage, and clearing a block does not imply any stage transition.

**How to apply:** Do not infer a stage from a blocked reason in imports. Count each task in exactly one stage and count blocked tasks separately, even when those counts overlap. Gold/Silver/Bronze tier remains informational until the user defines a rule for it.