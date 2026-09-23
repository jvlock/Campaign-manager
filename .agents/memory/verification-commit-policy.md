---
name: Verification and commit policy
description: Project-owner distinction between physical commits and acceptance of a phase.
---

A build-agent commit may exist provisionally. Never report a phase accepted or complete until every required verification gate passes. Preserve failed provisional commits and make corrections as separate follow-up commits; do not reset, amend, squash, or rewrite history to hide failures.

**Why:** The project owner explicitly revised the policy after automatic commits appeared before verification. A commit's existence is not the completion decision.

**How to apply:** Report inspected commit history and actual verification outcomes separately. Do not infer acceptance from a clean working tree or a commit message.

For a final evaluator batch, complement passing focused tests and typechecking with adversarial examples against each aggregate's applicability, scope, chronology and dependency edges before the full gate. A downstream result must not pass by omitting one required upstream finding or by treating a conditional not-applicable result as a failure.

**Why:** Several independently verified happy-path suites passed while completion aggregators still had contradictory or missing-prerequisite paths. Counterexamples exposed these before the final verification claim.

**How to apply:** Derive a small failing example for each dependency and each state transition (including multiple participants and genuine not-applicable triggers), then make the failure independently named in the test suite. Keep this as a verification practice, not an additional product rule.