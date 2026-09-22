---
name: Webinar readiness rationale
description: Reasons behind the deliberately limited stage dependencies and conservative exception policy.
---

Do not turn webinar readiness into an implicit funnel in which every later stage requires every earlier stage to remain ready.

**Why:** The owner explicitly wants historical recruitment defects to remain visible without preventing an otherwise valid run or completion. Completion is about its own requirements and explicit remaining obligations, not retroactively repairing every historical stage.

**How to apply:** Preserve the explicitly approved dependency boundaries when adding future rules; do not infer prerequisites from stage ordering or names.

The owner explicitly gives failed non-exception-eligible rules blocking precedence, even where their catalog severity label sounds nonblocking.

**Why:** The canonical catalog includes Warning and Optional rules marked non-exception-eligible. Silently treating these failures as advisory would contradict the supplied precedence rule.

**How to apply:** Any change to this precedence requires clarification/authorization, not a routine severity-based refactor.