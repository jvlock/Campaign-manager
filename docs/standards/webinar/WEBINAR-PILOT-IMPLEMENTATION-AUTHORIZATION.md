# Webinar Pilot — Controlled Implementation Authorization

Archived verbatim from the product-owner instruction authorizing controlled pilot implementation of WEB-STANDARD-001. This is the governing authorization for the pilot build in Campaign Manager. It supersedes nothing in WEB-STANDARD-001.md or WEB-STANDARD-001.rules.json; it governs how the standard may be implemented, not what the standard says.

---

## WEBINAR PILOT — CONTROLLED IMPLEMENTATION AUTHORIZATION

WEB-STANDARD-001 is approved for controlled pilot implementation, subject to the corrections and decisions in this instruction.

This authorizes a limited pilot build in Campaign Manager. It does not authorize public deployment, production email delivery, migration of existing webinars, repository consolidation, full application security, or retirement of either application.

Campaign Manager remains the pilot host.

### 1. Mandatory preflight

Before changing code, verify that the complete 106-rule normalized catalog referenced in the Final Webinar Pilot Standard is available in the repository or attached to this request.

The catalog must contain, for every rule: stable rule ID, rule name, hierarchy level, trigger, expected behavior, primary rule type, evidence basis, readiness stage, validation method, exception eligibility, failure message, resolution guidance.

If the complete catalog is unavailable, stop and identify the missing artifact. Do not reconstruct 106 rules from the summary or invent replacements.

Create an implementation branch or equivalent isolated workspace and use an isolated database. Record the starting commit and migration state.

Do not modify retained production data.

### 2. Final product decisions

The following decisions are now settled.

**Taxonomy, naming, and UTM.** Governed taxonomy, standardized internal naming, campaign codes, and UTM generation are required for pilot acceptance. They may be temporarily represented as an identified dependency while individual screens are being built, but the pilot cannot be declared complete while they remain bypassed. Campaign Governance Foundation is the authoritative source for taxonomy, governed values, naming rules, campaign codes, UTM rules, and rule versions. Campaign Manager must consume the governed implementation. It must not create another editable taxonomy or UTM source. Campaign Manager's existing compiler may be reused only after automated compatibility tests demonstrate that it produces the required output from Foundation-governed inputs. If outputs differ, document the differences and stop for a decision rather than silently choosing one.

**Existing webinars.** Existing legacy_9 and default_5 webinar sessions remain on their original template versions through completion. Do not migrate them and do not offer a mid-cycle upgrade during the pilot. After WEB-STANDARD-001 passes pilot verification: use it for new webinar creation; deprecate legacy templates for new creation; preserve legacy templates for historical and in-progress records; do not delete legacy versions.

**Attendance-unknown content.** Placeholder content may be used in isolated development previews. No placeholder or unapproved neutral follow-up may be sent to a real recipient. Attendance-unknown follow-up content is a readiness blocker until approved. If attendance can be reconciled within two business days, route the registrant to the attended or absent variant instead.

### 3. Correct the data model

Do not add one attendance-status field to the webinar session. Attendance is a per-registrant state. Use the existing registration and attendance structures where possible and represent, per registrant: registered, waitlisted, cancelled, attended, absent, attendance unknown, internal or test.

Preserve event-level status separately, such as: draft, open for registration, scheduled, in progress, completed, cancelled.

Do not conflate event status with participant status.

Implement only the minimum new data required for: standard definition and version; webinar-to-standard-version reference; rule evaluation results where persistence is justified; exceptions; evaluation timestamps; evaluation evidence; per-registrant operational state if the existing model cannot represent it safely.

Use explicit migrations with rollback procedures.

### 4. Calculate readiness rather than manually setting it

The authoritative readiness state must be calculated from: WEB-STANDARD-001 version, applicable rules, current webinar data, communication configuration, deliverable status, participant-state requirements, exceptions, external dependencies.

Do not rely on a manually editable stage field.

If readiness is cached for performance, store: calculated stage, standard version, evaluation timestamp, rule-result summary, input or record version used, stale or current indicator.

Recalculate readiness whenever a relevant field, deliverable, communication, date, exception, or dependency changes.

The interface must show four separate stages: ready to recruit, ready to run, ready to follow up, complete.

Each stage must show: passed rules, blockers, warnings, exceptions, external dependencies, resolution guidance.

Do not show a standalone percentage as the authoritative result.

### 5. Pilot delivery boundary

Unless direct repository inspection proves that a real external sending integration already exists and is explicitly authorized, the pilot must not send communications.

The pilot should: generate the communication plan; calculate dates; apply audience-state rules; simulate suppression; validate configuration; produce previews; export a campaign package; show what would be sent, when, to which eligible state, and why.

Label all such functionality as planned, preview, simulated, or export as appropriate.

Do not label a communication sent, delivered, opened, or clicked without evidence from a real integrated system.

Do not add a new external email or webinar-platform integration in this phase.

### 6. Suppression and audience-state logic

Recruitment eligibility must be evaluated at the person or audience-member level.

Suppress from recruitment: registered people; waitlisted people unless the approved waitlist policy calls for communication; cancelled registrants; opted-out or otherwise ineligible people; invalid addresses; internal or test records; governed campaign exclusions.

Registration must immediately move the person from the non-registrant recruitment path to the registrant path.

Internal and test records are not a customer communication path and must be excluded from reporting.

Attendance unknown is an operational reconciliation state. It must never cause both attended and absent follow-ups to be generated.

### 7. Deliverable correction

Attended and absent follow-ups require distinct message variants. They do not automatically require separate content assets or destinations.

Permit: one shared recording or follow-up asset; different attended and absent messaging; different CTAs where the objective requires them.

Block follow-up readiness when a required destination or approved message variant is missing.

### 8. Guided pilot experience

Build the experience with progressive disclosure. Do not present all fields in one long form.

Use this screen sequence:

1. Webinar basics — title, objective, topic, format, date, time, duration, time zone, owner.
2. Audience and registration — intended audience, exclusions, registration destination, capacity, waitlist, consent or preference requirements.
3. Speakers and delivery — speakers, platform or venue, language, accessibility, recording plan, operational owner.
4. Recruitment plan — automatically generated cadence, shortened-window result, communications, channels, omissions, and suppression rules.
5. Registrant experience — confirmation, calendar information, 24-hour reminder, 1-hour reminder, change and cancellation handling.
6. Follow-up plan — attended, absent, attendance-unknown reconciliation, waitlisted, cancelled, and internal/test behavior.
7. Naming and tracking — standardized internal title, campaign code, taxonomy, and UTM preview from the governed source.
8. Readiness and exceptions — stage-based blockers, warnings, dependencies, exceptions, and resolution guidance.
9. Campaign package — a single exportable plan containing setup, audience, communications, deliverables, schedule, governed codes, readiness, exceptions, owners, and measurements.

Preserve the existing visual activity map where useful, but do not require users to construct the standard webinar sequence manually.

### 9. Implementation order

Implement in this order: (1) load and validate the complete WEB-STANDARD-001 rule catalog; (2) add the versioned standard and webinar-to-version reference; (3) implement rule evaluation without UI; (4) implement shortened-window calculations; (5) implement person-level state and suppression simulation; (6) implement stage-based readiness; (7) connect Foundation-governed taxonomy, naming, codes, and UTM rules; (8) build the guided screens; (9) build communication and deliverable previews; (10) build the campaign-package export; (11) run automated tests; (12) conduct manual UX QA using representative webinar scenarios; (13) verify legacy-template non-regression; (14) produce implementation evidence.

Do not retire legacy templates during initial implementation.

### 10. Required test scenarios

At minimum, test: full 21-day recruitment window; each shortened-window band and every boundary; date changed after communications are generated; date moved into the past; time-zone and daylight-saving boundary; registration after one or more reminders have passed; registered person removed from recruitment; waitlisted person promoted; registrant cancellation; event cancellation; event rescheduling; attended participant; absent participant; attendance unknown and later reconciled; attendance remaining unknown after two business days; internal/test exclusion; invalid-address exclusion; opt-out exclusion; shared follow-up asset with distinct message variants; missing registration page; failed registration test; failed join-link test; missing speaker; missing follow-up content; missing taxonomy or UTM dependency; approved exception; non-exception-eligible blocker; existing legacy_9 session unchanged; existing default_5 session unchanged.

Test against an isolated database.

### 11. UX acceptance criteria

A pilot marketer must be able to: understand what information is required without training; create a webinar plan without manually building every standard communication; see why each communication exists; see how dates were calculated; understand which audiences receive or do not receive each communication; identify missing work immediately; correct a blocker from the readiness screen; preview naming, taxonomy, campaign codes, and UTMs; see attended and absent follow-up as distinct variants; export a coherent campaign package.

Conduct manual QA at desktop and narrow/mobile widths.

Check empty, loading, error, validation, warning, exception, and success states.

### 12. Pilot acceptance criteria

Do not report the pilot complete until: the full approved rule catalog is implemented and traceable; automated tests pass; manual UX QA passes; no communication is scheduled in the past; participant states and event states remain correctly separated; suppression behaves correctly; readiness recalculates after relevant changes; Foundation-governed taxonomy, naming, campaign codes, and UTM outputs are connected and verified; legacy webinars remain unchanged; no real external message is sent; the campaign package is exportable; the Replit access gate remains in place; no sensitive or regulated data is used.

### 13. Evidence required at completion

Return: starting and ending commit identifiers; files changed; migrations created; data-model explanation; rule coverage report mapping every rule ID to implementation and tests; automated test commands and full results; manual QA scenarios and results; screenshots of every pilot screen; known limitations; deferred work; rollback procedure; confirmation that no production data changed; confirmation that no external communication was sent; confirmation that no legacy webinar was migrated; confirmation that the application remains private.

If any acceptance criterion is not verified, label the result Partially implemented or Unverified. Do not report it Complete.

Proceed with the controlled pilot implementation and stop before deployment or any real external send.

---

## Cross-reference notes added during archiving

The mandatory preflight in section 1 above is the specific requirement that this implementation packet exists to satisfy: it places the complete, machine-readable rule catalog into the repository as a real artifact rather than relying on prose reconstruction or a build-agent prompt to carry its content. See the accompanying manifest.json for the validation result confirming whether the catalog as packaged actually meets the twelve-field completeness this section requires, since the packaging step surfaced gaps in the original catalog that this authorization's own preflight language anticipates as a valid stop condition.

The data-model correction in section 3 above (per-registrant attendance state, separate event-level status) is the same correction already reflected in WEB-STANDARD-001.md and was not altered during archiving.

Nothing in this authorization was modified during archiving. It is reproduced in full above.
