---
name: Verification and commit policy
description: Project-owner distinction between physical commits and acceptance of a phase.
---

A build-agent commit may exist provisionally. Never report a phase accepted or complete until every required verification gate passes. Preserve failed provisional commits and make corrections as separate follow-up commits; do not reset, amend, squash, or rewrite history to hide failures.

**Why:** The project owner explicitly revised the policy after automatic commits appeared before verification. A commit's existence is not the completion decision.

**How to apply:** Report inspected commit history and actual verification outcomes separately. Do not infer acceptance from a clean working tree or a commit message.