import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import app from "../src/app";
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

test("activity POST provisions exactly five standard rows and replay map is idempotent", async () => {
  const createdCampaign = await campaign(`Webinar route activity ${randomUUID()}`);
  const response = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Route activity webinar",
      type: "Webinar",
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
  const activity = await response.json() as { id: string; rowVersion: number; position: { x: number; y: number } };
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
        name: "Route activity webinar",
        type: "Webinar",
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
    name: "Route session activity",
    type: "Webinar",
    audience: "Route test audience",
    region: "EMEA",
    timing: "2027-04-21",
    status: "Confirmed",
    owner: "Route test",
    x: "0",
    y: "0",
  }).returning();
  const response = await fetch(`${baseUrl}/campaigns/${createdCampaign.id}/webinars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId: activity.id,
      name: "Route session",
      sessionDate: setup.eventDate,
      startTime: setup.eventTime,
      durationMinutes: setup.durationMinutes,
      timezone: setup.timezone,
      platform: setup.platform,
      speakers: setup.speakers,
      recruitmentLaunchAt: setup.recruitmentLaunchAt,
      registrationRule: { suppressRecruitmentAfterRegistration: true },
       channel: "eml",
    }),
  });
  assert.equal(response.status, 201);
  const session = await response.json() as { id: string };
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