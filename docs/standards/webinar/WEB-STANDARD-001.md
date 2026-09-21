# WEB-STANDARD-001 — Webinar Activity Standard (Release Candidate 1)

Standard version: 1.0-pilot-rc1. This document must be read together with `WEB-STANDARD-001.rules.json`, which is the canonical, machine-readable source, and `CHANGELOG-RC1.md`, which records every field changed from the prior packet. Where any statement here appears to conflict with the JSON file, the JSON file governs.

## Scope

Webinar is an Activity type, not a Journey type. A webinar may exist as a standalone Activity within a Campaign, or as one Activity within a Real Nurture journey. It is never itself an Activation journey and never itself a Journey. This is unchanged from the prior release.

## Required and conditional setup

Twenty required setup fields (rules WEB-SETUP-001 through WEB-SETUP-020) and eight conditional fields (rules WEB-SETUP-C01 through C08) are unchanged in substance from the prior release. In this release candidate, every conditional field now carries an explicit hierarchy level of Activity and an explicit readiness stage: capacity, waitlist, paid or organic promotional support, language, and consent or preference language are evaluated at ready to recruit; handraiser CTA and sales follow-up rule are evaluated at ready to follow up; accessibility requirements are evaluated at ready to run. This closes a gap in the prior release, where the conditional-fields section did not state these two properties at all.

## Recruitment cadence

Unchanged. Four communications at twenty-one, fourteen, seven, and one day before the event, with suppression rules covering registered, opted-out, cancelled, internal or test, invalid-address, and governed-exclusion records, and an absolute prohibition on scheduling any communication in the past.

## Registrant cadence

Unchanged. Immediate confirmation, calendar and attendance information, a twenty-four-hour and a one-hour reminder, prompt change and cancellation notices, mandatory time-zone display, and a late-registrant rule preventing any backdated reminder.

## Audience-state follow-up

Unchanged in substance. Six states: attended, registered but absent, attendance unknown, waitlisted, cancelled, internal or test, each with the behavior described in the prior release and encoded in the rules whose IDs begin WEB-FU. Two optional rules in this group, the handraiser CTA follow-up for the attended and absent paths, and the labeled-test-send permission, now explicitly carry exceptionEligible false in this release candidate, since an optional rule that does not block progress has no exception to grant in the first place; this is a completeness correction, not a change to what those rules require.

## Shortened-window logic

Unchanged in its six bands and their thresholds. In this release candidate, every band rule, WEB-WIN-001 through WEB-WIN-006, now carries a fully specified validation method, evidence basis, hierarchy level, readiness stage, and a failure message and resolution guidance specific to that band rather than a shared generic message. The omitted-communication display rule, WEB-WIN-007, was already complete in the prior release and is unchanged here.

## Readiness

Unchanged in its four-stage structure: ready to recruit, ready to run, ready to follow up, complete. In this release candidate, every readiness-stage rule now states an explicit trigger identifying which stage it evaluates, and a failure message and resolution guidance specific to what actually prevents that stage from passing, rather than the rule name alone. One substantive change in this release candidate: WEB-RDY-REC-008, governing whether governed naming, taxonomy, and UTM output are available, is now a plain mandatory blocker with no exception path. The prior release allowed a documented-dependency bypass at this specific point; that bypass is removed. The dependency may still be displayed to the user as a known implementation gap while development is underway, but it no longer allows the ready-to-recruit stage to pass.

## Operational and QA requirements

Unchanged in which checks exist. In this release candidate, two of them are strengthened as plain mandatory blockers rather than conditionally deferred. WEB-QA-005, governed UTM generation, previously read as a conditional blocker partially supported pending a governed-source connection; it now requires governed UTM output for every applicable communication, with no exception, before the ready-to-recruit stage can pass. WEB-REC-004, the final one-day recruitment communication, is now explicitly a conditional blocker whose only valid omission is the shortened-window logic itself; a marketer cannot separately request an exception to skip it. Registration-flow testing and join-link or venue testing remain, as before, mandatory blockers with no exception path at all. WEB-EXC-001, the rule governing exception records themselves, is now explicit that an incomplete exception never satisfies the rule it was invoked against, that the original blocker remains active at its originating stage until the exception record is complete and valid, and that this rule cannot exempt itself.

## Measurement

Unchanged. WEB-MEAS-001 concerns the presence of a defined measurement plan and its targets before recruitment; actual result capture is a separate requirement at the complete stage, WEB-RDY-COMP-004, and this release candidate keeps that distinction explicit rather than conflating the two.

## Existing template treatment

Unchanged. Neither legacy_9 nor default_5 is adopted as this standard. Existing webinars remain linked to their original template version and are not migrated. A controlled upgrade is offered only after this standard passes pilot verification, and the legacy templates are deprecated for new creation, never deleted, only at that point.

## What changed from the prior release, at a glance

Every field that was null in the prior packet now carries a real value; none were filled with a placeholder term. Two rules changed in substance rather than only in completeness: WEB-QA-005 and WEB-RDY-REC-008 both close a bypass that would have allowed the pilot to reach a recruit-ready state without governed naming, taxonomy, or UTM output actually connected. WEB-REC-004's rule type was corrected from an ambiguous compound phrase to a clean, approved enumeration value. The complete, field-by-field record of every change is in `CHANGELOG-RC1.md`.

## Correspondence to the JSON catalog

Every statement above corresponds to one or more rule IDs in `WEB-STANDARD-001.rules.json`, and this document does not assert anything the JSON catalog does not also encode. This release candidate's manifest reports zero null required fields, zero non-conforming enumeration values, and zero non-boolean exception-eligibility values, which this document's content should be read as consistent with rather than independently verified against.
