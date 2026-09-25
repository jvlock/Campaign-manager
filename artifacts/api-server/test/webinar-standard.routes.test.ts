import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import app from "./helpers/legacy-app";
import {
  activities,
  audiences,
  campaigns,
  communications,
  communicationCtas,
  ctas,
  db,
  scheduleRules,
  scheduledInstanceHistory,
  scheduledInstances,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
  webinarStandardCommunications,
  webinarStandardConfigs,
  webinarStandardTriggerEvents,
  landingPages,
} from "@workspace/db";
import { communicationDetails } from "@workspace/db/schema/communication-details";
import { allowsDevelopmentPlanning } from "../src/lib/development-policy";

let server: Server;
let baseUrl: string;
const campaignIds: string[] = [];

const setup = {
  eventDate: "2027-04-21",
  eventTime: "14:00",
  durationMinutes: 60,
  timezone: "America/New_York",
  platform: "Planning platform",
  speakers: [{ name: "Route test speaker" }],
  recruitmentLaunchAt: "2027-03-01T15:00:00.000Z",
};
const defaultFiveKeys = [
  "recruitment_1",
  "recruitment_2",
  "registered_reminder",
  "final_reminder",
  "attendee_followup",
] as const;
const legacyNineKeys = [
  "registration_confirmation",
  "recruitment_1",
  "recruitment_2",
  "recruitment_3",
  "final_recruitment",
  "registered_reminder",
  "final_reminder",
  "attendee_followup",
  "no_show_followup",
] as const;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Route test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

async function campaign(name: string) {
  const [created] = await db.insert(campaigns).values({
    name,
    scope: "Regional",
    region: "EMEA",
    audience: "Route test audience",
    outcome: "Verify webinar standard routes",
  }).returning();
  campaignIds.push(created.id);
  return created;
}

async function cleanupCampaign(campaignId: string) {
  const sessionRows = await db.select({ id: webinarSessions.id }).from(webinarSessions).where(eq(webinarSessions.campaignId, campaignId));
  const instanceRows = await db.select({ id: scheduledInstances.id }).from(scheduledInstances).where(eq(scheduledInstances.campaignId, campaignId));
  if (instanceRows.length) {
    await db.delete(scheduledInstanceHistory).where(inArray(scheduledInstanceHistory.scheduledInstanceId, instanceRows.map((row) => row.id)));
  }
  await db.delete(webinarStandardTriggerEvents).where(eq(webinarStandardTriggerEvents.campaignId, campaignId));
  await db.delete(scheduledInstances).where(eq(scheduledInstances.campaignId, campaignId));
  await db.delete(scheduleRules).where(eq(scheduleRules.campaignId, campaignId));
  await db.delete(webinarStandardCommunications).where(eq(webinarStandardCommunications.campaignId, campaignId));
  await db.delete(webinarStandardConfigs).where(eq(webinarStandardConfigs.campaignId, campaignId));
  await db.delete(communicationCtas).where(eq(communicationCtas.campaignId, campaignId));
  await db.delete(ctas).where(eq(ctas.campaignId, campaignId));
  await db.delete(landingPages).where(eq(landingPages.campaignId, campaignId));
  await db.delete(communicationDetails).where(eq(communicationDetails.campaignId, campaignId));
  await db.delete(communications).where(eq(communications.campaignId, campaignId));
  if (sessionRows.length) await db.delete(webinarSessions).where(eq(webinarSessions.campaignId, campaignId));
  await db.delete(activities).where(eq(activities.campaignId, campaignId));
  await db.delete(webinarPeople).where(eq(webinarPeople.campaignId, campaignId));
  await db.delete(audiences).where(eq(audiences.campaignId, campaignId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
}

async function linkPublishedCta(campaignId: string, sessionId: string) {
  const created = await fetch(`${baseUrl}/campaigns/${campaignId}/ctas`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Canonical webinar CTA",
      buttonText: "Join",
      destinationUrl: "https://example.com",
      owner: "Route test",
      status: "Published",
      publishBy: null,
    }),
  });
  assert.equal(created.status, 201);
  const cta = await created.json() as { id: string };
  const rows = await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, sessionId));
  for (const row of rows) {
    assert.ok(row.communicationId);
    const linked = await fetch(`${baseUrl}/campaigns/${campaignId}/communications/${row.communicationId}/dependencies`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ctaIds: [cta.id], landingPageIds: [] }),
    });
    assert.equal(linked.status, 200);
  }
  return { cta, rows };
}

after(async () => {
  server.close();
  for (const campaignId of campaignIds) await cleanupCampaign(campaignId);
});

test("guarded webinar edits preview existing scheduling decisions without writes and reject concurrent stale saves", async () => {
  assert.equal(allowsDevelopmentPlanning("POST", "/campaigns/any/webinars/any/date-impact-preview"), true);
  assert.equal(allowsDevelopmentPlanning("GET", "/campaigns/any/webinars/any/date-impact-preview"), false);
  const createdCampaign = await campaign(`Preview route ${randomUUID()}`);
  const [activity] = await db.insert(activities).values({
    campaignId: createdCampaign.id,
    name: `${createdCampaign.name}-webinar-Preview`,
    generatedName: `${createdCampaign.name}-webinar-Preview`,
    namingInput: "Preview",
    type: "webinar",
    activityTypeId: "webinar",
    audience: "Route test audience",
    region: "EMEA",
    timing: setup.eventDate,
    status: "Confirmed",
    owner: "Route test",
    x: "0", y: "0",
  }).returning();
  const created = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activity.id, sessionDate: setup.eventDate, startTime: setup.eventTime,
      durationMinutes: setup.durationMinutes, timezone: setup.timezone,
      platform: setup.platform, speakers: setup.speakers,
      recruitmentLaunchAt: setup.recruitmentLaunchAt,
    }),
  });
  assert.equal(created.status, 201);
  const { id: sessionId } = await created.json() as { id: string };
  const sessionUrl = `${baseUrl}/campaigns/${createdCampaign.id}/webinars/${sessionId}`;
  const standardUrl = `${sessionUrl}/standard`;
  const fetchSession = async () => (await (await fetch(sessionUrl)).json()) as { sessionDate: string; editVersion: string };
  const first = await fetchSession();
  assert.match(first.editVersion, /^[0-9a-f]{64}$/);
  const missingVersion = await fetch(`${sessionUrl}/date-impact-preview`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionDate: "2027-03-03" }),
  });
  assert.equal(missingVersion.status, 400);
  const injectedCalculatedField = await fetch(`${sessionUrl}/date-impact-preview`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: first.editVersion, sessionDate: "2027-03-03", scheduledAt: "2027-01-01T00:00:00Z" }),
  });
  assert.equal(injectedCalculatedField.status, 400);
  const priorStandard = await (await fetch(standardUrl)).json() as { editVersion: string; communications: Array<{ key: string; scheduled: { status: string; effectiveAt: string | null } }> };
  assert.equal(priorStandard.editVersion, first.editVersion, "ordinary standard reads do not change the content revision");
  const beforeSession = await db.select().from(webinarSessions).where(eq(webinarSessions.id, sessionId));
  const beforeRows = await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, sessionId));
  const beforeInstances = await db.select().from(scheduledInstances).where(eq(scheduledInstances.campaignId, createdCampaign.id));
  const beforeHistory = await db.select().from(scheduledInstanceHistory).where(inArray(scheduledInstanceHistory.scheduledInstanceId, beforeInstances.map((row) => row.id)));
  const preview = await fetch(`${sessionUrl}/date-impact-preview`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: first.editVersion, sessionDate: "2027-03-03" }),
  });
  assert.equal(preview.status, 200);
  const impact = await preview.json() as {
    editVersion: string;
    changedCount: number;
    shortenedWindowCount: number;
    touches: Array<{ key: string; previous: { scheduledAt: string | null }; proposed: { scheduledAt: string | null; status: string; overdue: boolean }; changed: boolean; shortenedWindow: boolean }>;
  };
  assert.equal(impact.editVersion, first.editVersion);
  assert.equal(impact.touches.length, priorStandard.communications.length);
  assert.ok(impact.changedCount > 0);
  assert.ok(impact.shortenedWindowCount > 0);
  assert.deepEqual(await db.select().from(webinarSessions).where(eq(webinarSessions.id, sessionId)), beforeSession);
  assert.deepEqual(await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, sessionId)), beforeRows);
  assert.deepEqual(await db.select().from(scheduledInstances).where(eq(scheduledInstances.campaignId, createdCampaign.id)), beforeInstances);
  assert.deepEqual(await db.select().from(scheduledInstanceHistory).where(inArray(scheduledInstanceHistory.scheduledInstanceId, beforeInstances.map((row) => row.id))), beforeHistory);
  const saved = await fetch(sessionUrl, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: impact.editVersion, sessionDate: "2027-03-03" }),
  });
  assert.equal(saved.status, 200);
  const after = await saved.json() as { sessionDate: string; editVersion: string };
  assert.equal(after.sessionDate, "2027-03-03");
  assert.notEqual(after.editVersion, first.editVersion);
  const afterStandard = await (await fetch(standardUrl)).json() as typeof priorStandard;
  for (const touch of impact.touches) {
    const savedTouch = afterStandard.communications.find((candidate) => candidate.key === touch.key);
    assert.ok(savedTouch);
    assert.equal(savedTouch.scheduled.effectiveAt, touch.proposed.scheduledAt, touch.key);
    assert.equal(savedTouch.scheduled.status, touch.proposed.status, touch.key);
  }
  const [raceA, raceB] = await Promise.all(["2027-03-04", "2027-03-05"].map((sessionDate) =>
    fetch(sessionUrl, { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: after.editVersion, sessionDate }) })));
  assert.deepEqual([raceA.status, raceB.status].sort(), [200, 409]);
  const rejected = raceA.status === 409 ? raceA : raceB;
  assert.equal((await rejected.json() as { error: { code: string } }).error.code, "CONFLICT");
  const latest = await fetchSession();
  const staleStandard = await fetch(standardUrl, { method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: after.editVersion, communications: [{ key: "recruitment_1", status: "DRAFT" }] }) });
  assert.equal(staleStandard.status, 409);
  const guardedStandard = await fetch(standardUrl, { method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: latest.editVersion, communications: [{ key: "recruitment_1", status: "PLANNED" }] }) });
  assert.equal(guardedStandard.status, 200);
  const postStandard = await fetchSession();
  assert.notEqual(postStandard.editVersion, latest.editVersion);
  const stalePreview = await fetch(`${sessionUrl}/date-impact-preview`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: latest.editVersion, sessionDate: "2027-03-06" }) });
  assert.equal(stalePreview.status, 409);
  assert.equal((await fetchSession()).sessionDate, latest.sessionDate);
  const dstPreviewResponse = await fetch(`${sessionUrl}/date-impact-preview`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: postStandard.editVersion, sessionDate: "2027-03-15" }),
  });
  assert.equal(dstPreviewResponse.status, 200);
  const dstPreview = await dstPreviewResponse.json() as typeof impact & { calculatedAt: string };
  assert.ok(Number.isFinite(Date.parse(dstPreview.calculatedAt)), "overdue is assessed at a transient preview time");
  assert.equal(dstPreview.touches.find((touch) => touch.key === "registered_reminder")?.proposed.scheduledAt,
    "2027-03-14T18:00:00.000Z", "24 elapsed hours before a 14:00 New York event after spring DST");
  assert.equal(dstPreview.touches.find((touch) => touch.key === "final_reminder")?.proposed.scheduledAt,
    "2027-03-15T17:00:00.000Z", "one elapsed hour before the event, in daylight time");
  const dstSave = await fetch(sessionUrl, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: dstPreview.editVersion, sessionDate: "2027-03-15" }),
  });
  assert.equal(dstSave.status, 200);
  const dstSavedStandard = await (await fetch(standardUrl)).json() as typeof priorStandard;
  for (const touch of dstPreview.touches) {
    const persisted = dstSavedStandard.communications.find((candidate) => candidate.key === touch.key);
    assert.ok(persisted);
    assert.equal(persisted.scheduled.effectiveAt, touch.proposed.scheduledAt, touch.key);
    assert.equal(persisted.scheduled.status, touch.proposed.status, touch.key);
  }
  // Overdue flags are a read-time annotation, not stored schedule instants.
  assert.ok(dstPreview.touches.every((touch) => typeof touch.proposed.overdue === "boolean"));
});

test("activity POST provisions exactly five standard rows and replay map is idempotent", async () => {
  const createdCampaign = await campaign(`Webinar route activity ${randomUUID()}`);
  const rejected = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Caller-provided webinar identifier",
      activityTypeId: "webinar",
      namingInput: "Route activity webinar",
      answers: {},
      audience: "Route test audience",
      region: "EMEA",
      timing: "2027-04-21",
      status: "Confirmed",
      owner: "Route test",
      position: { x: 0, y: 0 },
      webinarSetup: setup,
      rowVersion: 1,
    }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as any).error.code, "generated_identifier_not_accepted");

  const response = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      namingInput: "Route activity webinar",
      activityTypeId: "webinar",
      answers: {},
      audience: "Route test audience",
      region: "EMEA",
      timing: "2027-04-21",
      status: "Confirmed",
      owner: "Route test",
      position: { x: 0, y: 0 },
      webinarSetup: setup,
      rowVersion: 1,
    }),
  });
  assert.equal(response.status, 201);
  const activity = await response.json() as { id: string; name: string; generatedName: string; namingInput: string; rowVersion: number; position: { x: number; y: number } };
  assert.equal(activity.name, `${createdCampaign.name}-webinar-Route activity webinar`);
  assert.equal(activity.generatedName, activity.name);
  assert.equal(activity.namingInput, "Route activity webinar");
  const [session] = await db.select().from(webinarSessions).where(eq(webinarSessions.activityId, activity.id));
   assert.ok(session);
   assert.equal(session.templateVersion, "default_5");
   const standardRows = await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, session.id));
   assert.equal(standardRows.length, 5);
   assert.equal(new Set(standardRows.map((row) => row.key)).size, 5);
   assert.equal(new Set(standardRows.map((row) => row.communicationId)).size, 5);
   assert.equal((await db.select().from(communications).where(eq(communications.campaignId, createdCampaign.id))).length, 5);
  const automaticDetails = await db.select().from(communicationDetails)
    .where(eq(communicationDetails.campaignId, createdCampaign.id));
  assert.equal(automaticDetails.length, 5);
  assert.ok(automaticDetails.every((detail) => detail.channel === null));
  const standardConfig = await db.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.sessionId, session.id));
  assert.equal(standardConfig.length, 1);

  const currentCampaign = (await db.select().from(campaigns).where(eq(campaigns.id, createdCampaign.id)))[0];
  const mapReplay = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/map`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rowVersion: currentCampaign.rowVersion,
      activities: [{
        id: activity.id,
        name: activity.name,
        generatedName: activity.generatedName,
        namingInput: activity.namingInput,
        type: "webinar",
        activityTypeId: "webinar",
        answers: {},
        overrides: {},
        audience: "Route test audience",
        region: "EMEA",
        timing: "2027-04-21",
        status: "Confirmed",
        owner: "Route test",
        rowVersion: activity.rowVersion,
        position: { x: 0, y: 0 },
        webinarSetup: setup,
      }],
      connections: [],
    }),
  });
  assert.equal(mapReplay.status, 200);
  const sessionsAfterReplay = await db.select().from(webinarSessions).where(eq(webinarSessions.activityId, activity.id));
  const [sessionAfterReplay] = await db.select().from(webinarSessions).where(eq(webinarSessions.activityId, activity.id));
  const rowsAfterReplay = await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, sessionAfterReplay.id));
   assert.equal(sessionsAfterReplay.length, 1);
   assert.equal(rowsAfterReplay.length, 5);
});

test("session POST persists the five-message default and draft copy", async () => {
  const createdCampaign = await campaign(`Webinar route session ${randomUUID()}`);
  const [activity] = await db.insert(activities).values({
    campaignId: createdCampaign.id,
    name: `${createdCampaign.name}-webinar-Route session activity`,
    generatedName: `${createdCampaign.name}-webinar-Route session activity`,
    namingInput: "Route session activity",
    type: "webinar",
    activityTypeId: "webinar",
    audience: "Route test audience",
    region: "EMEA",
    timing: "2027-04-21",
    status: "Confirmed",
    owner: "Route test",
    x: "0",
    y: "0",
  }).returning();
  const sessionInput = {
    activityId: activity.id,
    sessionDate: setup.eventDate,
    startTime: setup.eventTime,
    durationMinutes: setup.durationMinutes,
    timezone: setup.timezone,
    platform: setup.platform,
    speakers: setup.speakers,
    recruitmentLaunchAt: setup.recruitmentLaunchAt,
    registrationRule: { suppressRecruitmentAfterRegistration: true },
    channel: "eml",
  };
  const rejected = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...sessionInput, name: "Caller session identifier" }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json() as any).error.code, "generated_identifier_not_accepted");

  const response = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionInput),
  });
  assert.equal(response.status, 201);
  const session = await response.json() as { id: string; name: string };
  assert.equal(session.name, activity.name);
  const rejectedRename = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Caller replacement identifier" }),
  });
  assert.equal(rejectedRename.status, 400);
  assert.equal((await rejectedRename.json() as any).error.code, "generated_identifier_not_accepted");
   const rows = await db.select().from(webinarStandardCommunications).where(eq(webinarStandardCommunications.sessionId, session.id));
   const [sessionRecord] = await db.select().from(webinarSessions).where(eq(webinarSessions.id, session.id));
   assert.equal(sessionRecord.templateVersion, "default_5");
   assert.equal(rows.length, 5);
  const explicitDetails = await db.select().from(communicationDetails)
    .where(eq(communicationDetails.campaignId, createdCampaign.id));
  assert.ok(explicitDetails.every((detail) => detail.channel === "eml"));
  assert.ok(rows.every((row) => row.status === "DRAFT"));
   assert.deepEqual(rows.map((row) => row.key), defaultFiveKeys);

  const draftPatch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      communications: [{
        key: "recruitment_1",
        variants: [{ slot: 1, content: { subject: "x".repeat(51) } }],
      }],
    }),
  });
  assert.equal(draftPatch.status, 200);
  const rejectedLegacyCtaPatch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      communications: [{ key: "recruitment_1", variants: [{ slot: 1, content: { ctaLabel: "Bypass" } }] }],
    }),
  });
  assert.equal(rejectedLegacyCtaPatch.status, 409);
  const [legacyRow] = await db.select().from(webinarStandardCommunications)
    .where(eq(webinarStandardCommunications.sessionId, session.id));
  const originalVariants = legacyRow.variants;
  const malformedVariants = (originalVariants as any[]).map((variant, index) => index === 0 ? {
    ...variant,
    content: { ...variant.content, ctaLabel: "Broken historical CTA", ctaUrl: "not-a-url" },
  } : variant);
  await db.update(webinarStandardCommunications).set({ variants: malformedVariants })
    .where(eq(webinarStandardCommunications.id, legacyRow.id));
  const malformedReadinessResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/deliverables`);
  assert.equal(malformedReadinessResponse.status, 200);
  const malformedReadiness = await malformedReadinessResponse.json() as {
    communications: Array<{ communicationId: string; blockers: Array<{ code: string }> }>;
  };
  assert.ok(malformedReadiness.communications
    .find((communication) => communication.communicationId === legacyRow.communicationId)
    ?.blockers.some((blocker) => blocker.code === "legacy_webinar_cta_requires_migration"));
  await db.update(webinarStandardCommunications).set({ variants: originalVariants })
    .where(eq(webinarStandardCommunications.id, legacyRow.id));
  const invalidExport = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/export`);
  assert.equal(invalidExport.status, 422);

  const validPatch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateConfig: { variants: [{ slot: 1, name: "Default", inUse: true, audienceDefinition: "All people", messageAngle: "Useful planning", valueProposition: "Clear next steps" }] },
      communications: defaultFiveKeys.map((key) => ({
        key,
        variants: [{
          slot: 1,
          content: {
            subject: "Subject",
            preheader: "Preheader",
            hero: "Hero",
            body: "Body",
          },
        }],
      })),
    }),
  });
  assert.equal(validPatch.status, 200);
  const canonical = await linkPublishedCta(createdCampaign.id, session.id);
  const validExportResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/export`);
  assert.equal(validExportResponse.status, 200);
   const validExport = await validExportResponse.json() as { communications: Array<{ key: string; scheduled?: { effectiveAt: string | null } }> };
   assert.equal(validExport.communications.length, 5);
  assert.ok(validExport.communications.find((communication) => communication.key === "recruitment_1")?.scheduled?.effectiveAt);
  const [page] = await db.insert(landingPages).values({
    campaignId: createdCampaign.id, name: "Historical published page missing URL",
    headline: "", supportingCopyNeeds: "", personalizationRequirements: "",
    owner: "Route test", status: "Published", url: null,
  }).returning();
  const unresolvedCtaResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/ctas`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Unresolvable page CTA", buttonText: "Open", landingPageId: page.id,
      owner: "Route test", status: "Published", publishBy: null,
    }),
  });
  assert.equal(unresolvedCtaResponse.status, 201);
  const unresolvedCta = await unresolvedCtaResponse.json() as { id: string };
  const firstRow = canonical.rows[0];
  assert.ok(firstRow.communicationId);
  const unresolvedLink = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/communications/${firstRow.communicationId}/dependencies`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ctaIds: [unresolvedCta.id], landingPageIds: [] }),
  });
  assert.equal(unresolvedLink.status, 200);
  const unresolvedExport = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/export`);
  assert.equal(unresolvedExport.status, 409);
  const unresolvedError = await unresolvedExport.json() as { error: string };
  assert.match(unresolvedError.error, /publishedUrl/);
  const restoredLink = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/communications/${firstRow.communicationId}/dependencies`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ctaIds: [canonical.cta.id], landingPageIds: [] }),
  });
  assert.equal(restoredLink.status, 200);
   assert.equal(validExport.communications.some((communication) => communication.key === "registration_confirmation" || communication.key === "no_show_followup"), false);
   const [audience] = await db.select().from(audiences).where(eq(audiences.campaignId, createdCampaign.id));
   const personResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/people`, {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ name: "Five template person", audienceBranchId: audience.id }),
   });
   assert.equal(personResponse.status, 201);
   const person = await personResponse.json() as { id: string };
   const eligibilityResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/eligibility`);
   assert.equal(eligibilityResponse.status, 200);
   const eligibility = await eligibilityResponse.json() as { people: Array<{ personId: string; communicationKey: string }> };
   assert.deepEqual(
     eligibility.people.filter((row) => row.personId === person.id).map((row) => row.communicationKey),
     [...defaultFiveKeys],
   );

   const skipLaunch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
     body: JSON.stringify({ launchAt: "2027-04-10T15:00:00.000Z" }),
  });
  assert.equal(skipLaunch.status, 200);
  const skippedExportResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/export`);
  assert.equal(skippedExportResponse.status, 200);
  const skippedExport = await skippedExportResponse.json() as { communications: Array<{ key: string }> };
  assert.equal(skippedExport.communications.some((communication) => communication.key === "recruitment_1"), false);

  const beforeAtomicFailure = (await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`)).json();
  const beforeConfig = (await beforeAtomicFailure).templateConfig.variants;
  const invalidPatch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateConfig: { variants: [{ slot: 1, name: "Default", inUse: false, audienceDefinition: "a", messageAngle: "b", valueProposition: "c" }] },
      communications: [{ key: "not_a_standard_key", variants: [] }],
    }),
  });
  assert.equal(invalidPatch.status, 400);
  const afterAtomicFailure = await (await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`)).json();
  assert.deepEqual(afterAtomicFailure.templateConfig.variants, beforeConfig);
});

test("registration confirmation is persisted per successful person event", async () => {
  const createdCampaign = await campaign(`Webinar route registration ${randomUUID()}`);
  const [activity] = await db.insert(activities).values({
    campaignId: createdCampaign.id,
    name: "Registration activity",
    type: "Webinar",
    audience: "Route test audience",
    region: "EMEA",
    timing: "2027-04-21",
    status: "Confirmed",
    owner: "Route test",
    x: "0",
    y: "0",
  }).returning();
  const [session] = await db.insert(webinarSessions).values({
    campaignId: createdCampaign.id,
    activityId: activity.id,
    name: "Registration session",
    sessionDate: setup.eventDate,
    startTime: setup.eventTime,
    durationMinutes: setup.durationMinutes,
    timezone: setup.timezone,
    platform: setup.platform,
    speakers: setup.speakers,
    recruitmentLaunchAt: new Date(setup.recruitmentLaunchAt),
    templateVersion: "legacy_9",
    registrationRule: { suppressRecruitmentAfterRegistration: true },
  }).returning();
  const sessionResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`);
  assert.equal(sessionResponse.status, 200);
  const standard = await sessionResponse.json() as { templateId: string; communications: Array<{ key: string }> };
  assert.equal(standard.templateId, "webinar_legacy_9");
  assert.equal(standard.communications.length, 9);
  const legacyCopyPatch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateConfig: { variants: [{ slot: 1, name: "Default", inUse: true, audienceDefinition: "All people", messageAngle: "Useful planning", valueProposition: "Clear next steps" }] },
      communications: legacyNineKeys.map((key) => ({
        key,
        variants: [{
          slot: 1,
          content: {
            subject: "Subject",
            preheader: "Preheader",
            hero: "Hero",
            body: "Body",
          },
        }],
      })),
    }),
  });
  assert.equal(legacyCopyPatch.status, 200);
  await linkPublishedCta(createdCampaign.id, session.id);
  const legacyExportResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/export`);
  assert.equal(legacyExportResponse.status, 200);
  const legacyExport = await legacyExportResponse.json() as { communications: Array<{ key: string }> };
  assert.equal(legacyExport.communications.length, 9);
  assert.equal(legacyExport.communications.some((communication) => communication.key === "registration_confirmation" || communication.key === "no_show_followup"), true);
  const skippedLaunch = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ launchAt: "2027-04-01T15:00:00.000Z" }),
  });
  assert.equal(skippedLaunch.status, 200);
  const [audience] = await db.select().from(audiences).where(eq(audiences.campaignId, createdCampaign.id));
  const personResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/people`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Registration person", audienceBranchId: audience.id }),
  });
  assert.equal(personResponse.status, 201);
  const person = await personResponse.json() as { id: string };
  const secondPersonResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/people`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Unregistered person", audienceBranchId: audience.id }),
  });
  assert.equal(secondPersonResponse.status, 201);
  const secondPerson = await secondPersonResponse.json() as { id: string };

  const registrationPath = `${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/people/${person.id}/registration`;
  const firstRegistration = await fetch(registrationPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: "registered" }),
  });
  assert.equal(firstRegistration.status, 200);
  let triggerEvents = await db.select().from(webinarStandardTriggerEvents).where(eq(webinarStandardTriggerEvents.personId, person.id));
  assert.equal(triggerEvents.length, 1);
  const repeatedRegistration = await fetch(registrationPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: "registered" }),
  });
  assert.equal(repeatedRegistration.status, 200);
  triggerEvents = await db.select().from(webinarStandardTriggerEvents).where(eq(webinarStandardTriggerEvents.personId, person.id));
  assert.equal(triggerEvents.length, 1);
  const firstRegisteredAt = (await db.select().from(webinarRegistrationResults).where(eq(webinarRegistrationResults.personId, person.id)))[0].firstRegisteredAt;
  assert.ok(firstRegisteredAt);

  const cancel = await fetch(registrationPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: "not_registered" }),
  });
  assert.equal(cancel.status, 200);
  const secondRegistration = await fetch(registrationPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: "registered" }),
  });
  assert.equal(secondRegistration.status, 200);
  const attendance = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/people/${person.id}/attendance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: "attended" }),
  });
  assert.equal(attendance.status, 200);
  triggerEvents = await db.select().from(webinarStandardTriggerEvents).where(eq(webinarStandardTriggerEvents.personId, person.id));
  assert.equal(triggerEvents.length, 2);
  const registration = (await db.select().from(webinarRegistrationResults).where(eq(webinarRegistrationResults.personId, person.id)))[0];
  assert.equal(registration.firstRegisteredAt?.toISOString(), firstRegisteredAt.toISOString());
  const standardResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard`);
  assert.equal(standardResponse.status, 200);
  const [confirmation] = await db.select().from(webinarStandardCommunications).where(and(
    eq(webinarStandardCommunications.sessionId, session.id),
    eq(webinarStandardCommunications.key, "registration_confirmation"),
  ));
  assert.equal(confirmation.originalScheduledAt, null);
  assert.equal(confirmation.effectiveScheduledAt, null);
  const eligibilityResponse = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars/${session.id}/standard/eligibility`);
  assert.equal(eligibilityResponse.status, 200);
  const eligibility = await eligibilityResponse.json() as {
    people: Array<{ personId: string; communicationKey: string; eligible: boolean; reason: string }>;
  };
  const eligibilityRow = (personId: string, communicationKey: string) =>
    eligibility.people.find((row) => row.personId === personId && row.communicationKey === communicationKey)!;
  assert.equal(eligibilityRow(secondPerson.id, "recruitment_1").eligible, false);
  assert.match(eligibilityRow(secondPerson.id, "recruitment_1").reason, /launch|skip/i);
  assert.equal(eligibilityRow(person.id, "recruitment_2").eligible, false);
  assert.match(eligibilityRow(person.id, "recruitment_2").reason, /registration history/i);
  assert.equal(eligibilityRow(person.id, "attendee_followup").eligible, true);
  assert.equal(eligibilityRow(person.id, "no_show_followup").eligible, false);
});