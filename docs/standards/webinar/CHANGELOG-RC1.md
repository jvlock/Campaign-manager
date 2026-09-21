# CHANGELOG-RC1 — WEB-STANDARD-001 1.0-pilot-rc1

Generated directly from the tracked field-level differences between the prior packet's rule catalog (standardVersion 1.0-pilot-draft) and this release candidate. Every entry below reflects an actual before/after value; none were reconstructed from memory.

**Total field changes:** 225 across **48 rules**.

**By kind:** mechanical normalization fills a gap or standardizes a value without altering the rule's approved meaning. Product-policy correction changes what the rule actually requires, per the explicit corrections in the RC1 normalization authorization.

---

## WEB-DONE-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Complete | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Complete | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | Every applicable rule across all readiness stages has passed or been resolved through a valid, complete exception where exception-eligible | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | One or more completion criteria across the readiness stages have not been satisfied. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Resolve every remaining blocker or complete every required exception before the webinar can be marked complete. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-EXC-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | The exception-governance rule cannot exempt itself. | product-policy correction |
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Complete | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Complete | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | Every exception used anywhere in the activity has a complete and valid record; an incomplete exception never satisfies the rule it was invoked against, and that rule's original blocker remains active at its originating readiness stage until the exception record is complete and valid | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | One or more exceptions used in this activity have an incomplete or invalid record, so the rule they were invoked against remains blocking. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Complete the exception record fully, or resolve the original blocker directly; this rule itself cannot be satisfied through an exception. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-FU-ABS-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Optional and warning rules do not block progress and therefore do not require an exception path; normalized per instruction. | mechanical normalization |

## WEB-FU-ATT-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Optional and warning rules do not block progress and therefore do not require an exception path; normalized per instruction. | mechanical normalization |

## WEB-FU-INT-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Optional and warning rules do not block progress and therefore do not require an exception path; normalized per instruction. | mechanical normalization |

## WEB-MEAS-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | The measurement plan and its targets are defined and present | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | The measurement plan or its targets are not defined. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Define the measurement plan and its targets before recruitment begins. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to run | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to run | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | At least one speaker is confirmed and has received necessary materials | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | Speaker readiness has not been confirmed. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Confirm speaker readiness, including receipt of necessary materials. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to run | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to run | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | The event brief or run-of-show is confirmed ready | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | Content or run-of-show readiness has not been confirmed. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Confirm the event brief or run-of-show is ready. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-003

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | The registration flow has been tested end to end and confirmed working | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | The registration flow has not been tested end to end. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Test the registration flow end to end; this rule cannot be bypassed by exception. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to run | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to run | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | The join link or venue has been tested and confirmed working | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | The join link or venue has not been tested. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Test the join link or venue; this rule cannot be bypassed by exception. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| primaryRuleType | Conditional blocker, Partially supported pending governed-source connection | Mandatory blocker | Approved product-policy correction: governed UTM generation is required for pilot acceptance, not conditionally deferred. | product-policy correction |
| exceptionEligible | True | False | Governed UTM generation is required for pilot acceptance and is not exception-eligible. | product-policy correction |
| readinessStage | null | Ready to recruit | Approved readiness-stage assignment. | product-policy correction |
| expectedBehavior | null | Governed UTM output is generated from the authoritative governance source for every applicable communication | Approved expected-behavior correction. | product-policy correction |
| hierarchyLevel | null | Activity/Communication | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| failureMessage | null | Governed UTM output has not been generated from the authoritative governance source for one or more applicable communications. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Connect to the governance source and generate governed UTM output for every applicable communication before proceeding. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-006

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | The internal title is generated from governed values, not typed manually | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | The internal title was typed manually rather than generated from governed values. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Regenerate the internal title from the governed naming source. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-007

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | Waitlist status, if in use, is visibly represented in the plan | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | Waitlist is in use but not represented in the plan. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Record waitlist status and management approach in the plan. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-008

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Automated | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | Both the recruitment owner and the follow-up owner are named | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | The recruitment owner or the follow-up owner is not named. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Name both the recruitment owner and the follow-up owner. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-QA-009

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved QA/operational-rule mapping table. | mechanical normalization |
| readinessStage | null | Ready to run | Approved QA/operational-rule mapping table. | mechanical normalization |
| validationMethod | null | Human confirmation | Approved QA/operational-rule mapping table. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved QA/operational-rule mapping. | mechanical normalization |
| trigger | null | When evaluating Ready to run | Approved QA/operational-rule trigger template. | mechanical normalization |
| expectedBehavior | null | All applicable QA checks are confirmed before the event | Approved QA/operational-rule expected behavior. | mechanical normalization |
| failureMessage | null | Final QA has not been confirmed before the event. | Rule-specific, actionable failure message. | mechanical normalization |
| resolutionGuidance | null | Complete and confirm all applicable QA checks before the event. | Rule-specific, actionable resolution guidance. | mechanical normalization |

## WEB-RDY-COMP-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Complete | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | Attendance has not been reconciled and its unresolved status has not been documented. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Reconcile attendance, or record the unresolved state as required by the attendance-unknown rules. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-COMP-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Complete | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | One or more required follow-up communications for the actual audience-state mix have not been completed. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Complete every required follow-up communication for each audience state present in this webinar. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-COMP-003

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Complete | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | An exception was used but its record is incomplete. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Complete the exception record before this webinar can be marked complete. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-COMP-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Complete | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The measurement targets defined in setup have not been recorded. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Record the measurement results against the plan defined in setup. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | One or more required setup fields in section A are incomplete. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Complete every required setup field before recruitment can begin. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The registration flow has not been tested end to end. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Run the registration flow test; this rule cannot be bypassed by exception. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-003

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The registration destination is missing or has not been validated as a tested, approved page. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Attach and validate an approved registration destination. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The immediate registration confirmation communication is not configured. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Configure the registration confirmation communication. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The recruitment communication set required by the applicable shortened-window band has not been configured. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Configure the communications required by the current band; see the shortened-window rules for the exact set. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-006

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | One or more recruitment suppression rules are not active. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Activate all required suppression rules before recruitment can begin. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-007

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The activity owner, recruitment owner, or follow-up owner is not assigned. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Assign all three required owners. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-REC-008

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| primaryRuleType | Conditional blocker | Mandatory blocker | Approved product-policy correction: removes the documented-dependency bypass as a readiness path. | product-policy correction |
| exceptionEligible | True | False | The governed-naming/taxonomy/UTM dependency may be displayed but is no longer a valid bypass of readiness. | product-policy correction |
| expectedBehavior | Governed name and UTM generated, or documented as unavailable due to the pilot's taxonomy dependency | Governed internal name, campaign code, taxonomy values, and applicable UTMs are available and verified | Approved expected-behavior correction; the dependency may be displayed but remains an unresolved blocker rather than a bypass. | product-policy correction |
| validationMethod | Automated, with Human confirmation for the documented-dependency path | Automated | Normalized to a single approved enumeration value; the compound "Automated, with Human confirmation for the documented-dependency path" is no longer applicable since the documented-dependency bypass was removed. | mechanical normalization |
| trigger | null | When evaluating Ready to recruit | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | Governed internal name, campaign code, taxonomy values, or applicable UTMs are missing or unverified. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Connect and verify the governed naming, taxonomy, and UTM source before proceeding; this is a required blocker, not a bypassable dependency. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The join link or venue has not been tested. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Test the join link or venue; this rule cannot be bypassed by exception. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | No speaker has been confirmed for this webinar. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Confirm at least one speaker. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-003

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The event brief or run-of-show is missing or incomplete. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Complete the event brief or run-of-show. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | Supporting content has not been confirmed ready. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Confirm supporting content is ready. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The 24-hour or 1-hour registrant reminder is not configured or validly omitted. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Configure the registrant reminders, or confirm their omission is valid under the approved cadence. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-RDY-RUN-006

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| trigger | null | When evaluating Ready to run | Approved readiness-rule trigger template. | mechanical normalization |
| evidenceBasis | null | Product-owner direction | Approved readiness-rule mapping. | mechanical normalization |
| failureMessage | null | The attendance capture mechanism has not been tested, and its absence has not been documented. | Rule-specific failure message stating what prevented the stage from passing. | mechanical normalization |
| resolutionGuidance | null | Test the attendance capture mechanism, or document why it is unavailable for this session. | Rule-specific resolution guidance telling the user what to correct. | mechanical normalization |

## WEB-REC-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| primaryRuleType | Mandatory blocker unless a valid omission applies | Conditional blocker | Approved product-policy correction: a valid conditional omission under the shortened-window logic is not an exception. | product-policy correction |
| exceptionEligible | True | False | A valid conditional omission is not an exception; this rule is not itself exception-eligible. | product-policy correction |
| trigger | Per shortened-window table | The 1-day recruitment communication is applicable under the selected recruitment-window band | Approved trigger correction. | product-policy correction |
| expectedBehavior | Communication scheduled 1 day before event or as adjusted | The communication is configured when applicable; omission is permitted only when the approved shortened-window logic makes it inapplicable | Approved expected-behavior correction. | product-policy correction |

## WEB-SETUP-C01

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C02

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C03

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to follow up | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C04

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Optional and warning rules do not block progress and therefore do not require an exception path; normalized per instruction. | mechanical normalization |
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C05

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C06

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Optional and warning rules do not block progress and therefore do not require an exception path; normalized per instruction. | mechanical normalization |
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to run | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C07

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | True | False | Legally or jurisdictionally required consent and preference language cannot be waived through this application. | product-policy correction |
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to recruit | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-SETUP-C08

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| hierarchyLevel | null | Activity | Approved conditional-setup mapping: activity-level scope, matching the required-fields section above it. | mechanical normalization |
| readinessStage | null | Ready to follow up | Approved conditional-setup readiness-stage mapping. | mechanical normalization |

## WEB-WIN-001

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | The full 21, 14, 7, and 1-day recruitment sequence was not produced for a webinar with 21 or more days remaining at creation. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Generate all four recruitment communications at 21, 14, 7, and 1 day before the event. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |

## WEB-WIN-002

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | The 14-to-20-day band's immediate-launch, 7-day, and 1-day communication set was not produced. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Generate an immediate launch communication and the 7- and 1-day recruitment communications; do not schedule the 21-day communication, since it cannot occur in the future. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |

## WEB-WIN-003

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | The 7-to-13-day band's immediate-launch and 1-day communication set was not produced. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Generate an immediate launch communication and the 1-day recruitment communication only. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |

## WEB-WIN-004

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | The 2-to-6-day band's immediate-launch communication, and its 1-day communication where separable by at least 24 hours, was not produced correctly. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Generate an immediate launch communication; add the 1-day communication only if it can be scheduled at least 24 hours after the immediate launch, otherwise send the immediate launch alone. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |

## WEB-WIN-005

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | The under-2-days band's immediate-launch communication with a compressed-window warning was not produced. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Generate the immediate-launch communication only, and display a compressed-window warning to the marketer. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |

## WEB-WIN-006

| Field | Previous value | New value | Reason | Change kind |
|---|---|---|---|---|
| exceptionEligible | null | False | Window-band rules are deterministic scheduling rules, not exception requests. | product-policy correction |
| validationMethod | null | Automated | Approved shortened-window mapping. | mechanical normalization |
| failureMessage | null | A recruitment communication was scheduled for an event that has already started or completed. | Rule-specific failure message identifying the failed band behavior; not a generic message. | mechanical normalization |
| resolutionGuidance | null | Remove the scheduled recruitment communication; no recruitment touch may be created once the event has started. | Rule-specific resolution guidance identifying the required communication set. | mechanical normalization |
