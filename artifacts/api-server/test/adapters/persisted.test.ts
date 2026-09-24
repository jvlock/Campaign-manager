import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleEvaluationInput, type AssemblySource } from "../../src/lib/webinar-domain-adapters";
import { occurrenceAssemblySource, type OccurrenceSources } from "../../src/lib/webinar-evaluation-sources";
import { common as validateDeliverableContext } from "../../src/lib/webinar-standard-evaluation/deliverable-helpers";
import { catalog } from "../evaluation/fixtures";

function fixture(): AssemblySource {
  const scope = { campaign_id: "campaign", session_id: "occurrence", activity_id: "activity" };
  const updated_at = "2030-01-01T00:00:00Z";
  return {
    campaign: { id: "campaign" }, activity: { id: "activity", campaignId: "campaign", activityType: "webinar" },
    occurrence: { id: "occurrence", campaignId: "campaign", activityId: "activity", sessionDate: "2030-06-01", startTime: "12:00", timezone: "UTC", durationMinutes: 60, platform: "", name: "Webinar" },
    calculationInstant: "2030-02-01T00:00:00Z", eventStatus: "scheduled",
    binding: { standardId: "WEB-STANDARD-001", standardVersion: "1.0-pilot-rc1" },
    persisted: {
      activity: { id: "activity", campaign_id: "campaign", owner: "Unverified planning owner", audience: "Developers" },
      communications: [
        { id: "att", ...scope, communication_id: "app-att", key: "attendee_followup", variants: [{ slot: 1, content: { body: "Thanks for attending" } }], updated_at },
        { id: "abs", ...scope, communication_id: "app-abs", key: "no_show_followup", variants: [{ slot: 1, content: { body: "Recording for those who missed it" } }], updated_at },
        { id: "rec", ...scope, communication_id: "app-rec", key: "recruitment_1", variants: [], schedule_status: "skipped", effective_scheduled_at: null, updated_at },
      ],
      applicationCommunications: ["att", "abs", "rec"].map(id => ({ id: `app-${id}`, campaign_id: "campaign", activity_id: "activity", owner: "Message owner" })),
      details: ["att", "abs", "rec"].map(id => ({ id: `detail-${id}`, campaign_id: "campaign", communication_id: `app-${id}`, channel: "email", qa_audience_confirmed: false, qa_content_approved: true, qa_links_verified: false, qa_timing_verified: true, qa_owner_confirmed: true })),
      assets: [{ id: "asset", campaign_id: "campaign", brief: "Reusable content brief", status: "Published", updated_at }],
      destinations: [{ id: "page", campaign_id: "campaign", supporting_copy_needs: "Page requirements", headline: "Headline", status: "Published", updated_at }],
      ctas: [{ id: "cta", campaign_id: "campaign", landing_page_id: "page", button_text: "View recording" }],
      communicationCtas: [{ campaign_id: "campaign", communication_id: "app-att", cta_id: "cta" }],
      communicationLandingPages: [{ campaign_id: "campaign", communication_id: "app-abs", landing_page_id: "page" }],
      landingPageAssets: [{ campaign_id: "campaign", landing_page_id: "page", content_asset_id: "asset" }],
    },
  };
}
test("persisted setup, configured content, linked destinations and scheduling map without invented evidence", () => {
  const result = assembleEvaluationInput(fixture());
  assert.deepEqual(result.mappingErrors, []);
  assert.equal(result.context?.setup?.owner, "Unverified planning owner");
  assert.equal(result.context?.setup?.activityType, "Webinar");
  assert.equal(result.context?.deliverables?.activityType, "Webinar");
  assert.equal(result.context?.setup?.intendedAudience, "Developers");
  assert.equal(result.context?.followUp.attended?.messageContent, "Thanks for attending");
  assert.equal(result.context?.followUp.absent?.destinationId, "page");
  assert.equal(result.context?.followUp.attended?.destinationId, "page");
  assert.equal(result.context?.followUp.distinctContentConfirmation, null);
  assert.equal(result.context?.scheduling?.configuredPlan?.touches[0]?.disposition, "omitted");
  assert.equal(result.context?.scheduling?.configuredPlan?.touches[0]?.scheduledAtEpochMs, null);
  assert.equal(result.context?.deliverables?.artifacts.length, 4);
  assert.ok(result.context?.deliverables?.artifacts.every(artifact => artifact.lifecycle === "planned" && artifact.reviews.length === 0));
  assert.equal(result.context?.deliverables?.communications[0]?.channel, "email");
  assert.equal(result.context?.deliverables?.complete, false);
  assert.ok(!result.missingInputs.some(gap => ["deliverables", "scheduling", "followUp"].includes(gap.field)));
  assert.ok(result.missingInputs.some(gap => gap.field.includes(".qaEvidence")));
  assert.equal(result.context?.registrationFlowTest, null);
  assert.equal(validateDeliverableContext(catalog, result.context!), null);
});
test("ambiguous slots and destinations do not silently pick a favorable variant", () => {
  const input = fixture();
  const rows = input.persisted!.communications.map(row => row.id === "att" ? { ...row, variants: [{ slot: 1, content: { body: "A" } }, { slot: 2, content: { body: "B" } }] } : row);
  const result = assembleEvaluationInput({ ...input, persisted: { ...input.persisted!, communications: rows } });
  assert.equal(result.context?.followUp.attended, null);
  assert.ok(result.missingInputs.some(gap => gap.field === "followUp.attended"));
  assert.equal(validateDeliverableContext(catalog, result.context!), null);
});
test("persisted joins remain scope checked; configured content versions change deterministically", () => {
  const input = fixture();
  const before = structuredClone(input);
  const original = assembleEvaluationInput(input);
  const reverse = assembleEvaluationInput({ ...input, persisted: { ...input.persisted!, communications: [...input.persisted!.communications].reverse() } });
  assert.deepEqual(original, reverse);
  const changed = assembleEvaluationInput({ ...input, persisted: { ...input.persisted!, assets: [{ ...input.persisted!.assets[0], brief: "Changed brief" }] } });
  assert.notEqual(original.context?.deliverables?.snapshotVersion, changed.context?.deliverables?.snapshotVersion);
  assert.deepEqual(input, before);
  assert.equal(assembleEvaluationInput({ ...input, persisted: { ...input.persisted!, details: [{ ...input.persisted!.details[0], campaign_id: "foreign" }] } }).context, null);
  assert.equal(assembleEvaluationInput({ ...input, persisted: { ...input.persisted!, communicationCtas: [{ campaign_id: "campaign", communication_id: "foreign", cta_id: "cta" }] } }).context, null);
});
test("loader projection wires actual application records into pure assembly", () => {
  const input = fixture();
  const p = input.persisted!;
  const sources = {
    ...p,
    campaign: { id: "campaign" }, activity: { ...p.activity, activity_type_id: "webinar", type: "Webinar" },
    occurrence: { id: "occurrence", campaign_id: "campaign", activity_id: "activity", session_date: "2030-06-01", start_time: "12:00", timezone: "UTC", duration_minutes: 60, platform: "", name: "Webinar", template_version: "default_5" },
    binding: { standard_id: "WEB-STANDARD-001", standard_version: "1.0-pilot-rc1", revision: 1 },
    records: [{ kind: "plan", payload: { eventStatus: "scheduled" } }],
  } as unknown as OccurrenceSources;
  const mapped = occurrenceAssemblySource(sources, input.calculationInstant as string);
  assert.equal(mapped.persisted?.details, p.details);
  assert.equal(mapped.persisted?.assets, p.assets);
  assert.equal(mapped.persisted?.communicationCtas, p.communicationCtas);
});