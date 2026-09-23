import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  activities,
  audiences,
  campaigns,
  db,
  scheduleRules,
  scheduledInstanceHistory,
  scheduledInstances,
} from "@workspace/db";
import {
  webinarAttendanceResults,
  webinarPeople,
  webinarRegistrationResults,
  webinarSessions,
} from "@workspace/db/schema/webinar";
import { evaluateWebinarPerson } from "../src/lib/webinar";
import { recomputeWebinarDeliveryAnchor } from "../src/lib/delivery";
import app from "./helpers/legacy-app";

let server: Server;
let baseUrl: string;
let campaignId: string;
let activityId: string;
let sessionId: string;
let attendedPersonId: string;
let noShowPersonId: string;
let unregisteredPersonId: string;
let ruleId: string;

before(async () => {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: "Webinar branch verification",
      scope: "Regional",
      region: "EMEA",
      audience: "Synthetic verification audience",
      outcome: "Verify webinar branches",
    })
    .returning();
  campaignId = campaign.id;
  const [activity] = await db
    .insert(activities)
    .values({
      campaignId,
      name: `${campaign.name}-webinar-Branch verification webinar`,
      generatedName: `${campaign.name}-webinar-Branch verification webinar`,
      namingInput: "Branch verification webinar",
      type: "webinar",
      activityTypeId: "webinar",
      audience: "Synthetic verification audience",
      region: "EMEA",
      timing: "2026-11-18",
      status: "Confirmed",
      owner: "Verification owner",
      x: "0",
      y: "0",
    })
    .returning();
  activityId = activity.id;
  const [audience] = await db
    .insert(audiences)
    .values({ campaignId, name: "Synthetic verification audience", region: "EMEA" })
    .returning();
  const [session] = await db
    .insert(webinarSessions)
    .values({
      campaignId,
      activityId,
      name: "Branch verification session",
      sessionDate: "2026-11-18",
      startTime: "14:00",
      durationMinutes: 60,
      timezone: "Europe/London",
      platform: "Planning platform",
      speakers: [{ name: "Taylor Reed", role: "Verification speaker" }],
      registrationRule: { suppressRecruitmentAfterRegistration: true },
    })
    .returning();
  sessionId = session.id;
  const [rule] = await db
    .insert(scheduleRules)
    .values({
      campaignId,
      activityId,
      anchorActivityId: activityId,
      offsetDays: 1,
      offsetMinutes: 0,
      direction: "before",
      businessDayStrategy: "calendar",
      audienceLocalTimezone: true,
      timezone: "Europe/London",
      targetSendTime: "09:00",
      enabled: true,
    })
    .returning();
  ruleId = rule.id;

  const [attended] = await db
    .insert(webinarPeople)
    .values({ campaignId, audienceBranchId: audience.id, name: "Synthetic Attended Person", isSynthetic: true })
    .returning();
  const [noShow] = await db
    .insert(webinarPeople)
    .values({ campaignId, audienceBranchId: audience.id, name: "Synthetic No Show Person", isSynthetic: true })
    .returning();
  const [unregistered] = await db
    .insert(webinarPeople)
    .values({ campaignId, audienceBranchId: audience.id, name: "Synthetic Unregistered Person", isSynthetic: true })
    .returning();
  attendedPersonId = attended.id;
  noShowPersonId = noShow.id;
  unregisteredPersonId = unregistered.id;
  await db.insert(webinarRegistrationResults).values([
    { campaignId, sessionId, personId: attended.id, result: "registered" },
    { campaignId, sessionId, personId: noShow.id, result: "registered" },
  ]);
  await db.insert(webinarAttendanceResults).values([
    { campaignId, sessionId, personId: attended.id, result: "attended" },
    { campaignId, sessionId, personId: noShow.id, result: "no_show" },
  ]);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Verification server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  server.close();
  const instances = await db
    .select({ id: scheduledInstances.id })
    .from(scheduledInstances)
    .where(eq(scheduledInstances.campaignId, campaignId));
  if (instances.length) {
    await db
      .delete(scheduledInstanceHistory)
      .where(inArray(scheduledInstanceHistory.scheduledInstanceId, instances.map((row) => row.id)));
  }
  await db.delete(scheduledInstances).where(eq(scheduledInstances.campaignId, campaignId));
  await db.delete(scheduleRules).where(eq(scheduleRules.campaignId, campaignId));
  await db.delete(webinarAttendanceResults).where(eq(webinarAttendanceResults.sessionId, sessionId));
  await db.delete(webinarRegistrationResults).where(eq(webinarRegistrationResults.sessionId, sessionId));
  await db.delete(webinarSessions).where(eq(webinarSessions.id, sessionId));
  await db.delete(webinarPeople).where(eq(webinarPeople.campaignId, campaignId));
  await db.delete(audiences).where(eq(audiences.campaignId, campaignId));
  await db.delete(activities).where(eq(activities.id, activityId));
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
});

test("webinar evaluation persists separate results and suppresses recruitment after registration", async () => {
  const attended = await evaluateWebinarPerson(campaignId, sessionId, attendedPersonId);
  assert.equal(attended.branch, "attended");
  assert.equal(attended.registrationResult, "registered");
  assert.equal(attended.attendanceResult, "attended");
  assert.equal(attended.recruitmentSuppressed, true);
  assert.equal(attended.externalSending, false);

  const noShow = await evaluateWebinarPerson(campaignId, sessionId, noShowPersonId);
  assert.equal(noShow.branch, "no_show");
  assert.equal(noShow.recruitmentSuppressed, true);

  const unregistered = await evaluateWebinarPerson(campaignId, sessionId, unregisteredPersonId);
  assert.equal(unregistered.branch, "not_registered");
  assert.equal(unregistered.recruitmentSuppressed, false);

  const registrationRows = await db
    .select()
    .from(webinarRegistrationResults)
    .where(and(eq(webinarRegistrationResults.sessionId, sessionId), eq(webinarRegistrationResults.personId, attendedPersonId)));
  const attendanceRows = await db
    .select()
    .from(webinarAttendanceResults)
    .where(and(eq(webinarAttendanceResults.sessionId, sessionId), eq(webinarAttendanceResults.personId, attendedPersonId)));
  assert.equal(registrationRows.length, 1);
  assert.equal(attendanceRows.length, 1);
});

test("session anchor recompute updates the calculated instance and preserves its original audit", async () => {
  const [initial] = await db
    .select()
    .from(scheduledInstances)
    .where(eq(scheduledInstances.ruleId, ruleId));
  assert.equal(initial, undefined);

  await recomputeWebinarDeliveryAnchor({
    campaignId,
    activityId,
    sessionDate: "2026-11-18",
    startTime: "14:00",
    timezone: "Europe/London",
    durationMinutes: 60,
  });
  const [created] = await db
    .select()
    .from(scheduledInstances)
    .where(eq(scheduledInstances.ruleId, ruleId));
  assert.ok(created);
  const originalCalculatedAt = created.originalCalculatedAt.toISOString();
  const firstCalculatedAt = created.calculatedAt.toISOString();

  await db
    .update(webinarSessions)
    .set({ sessionDate: "2026-11-19", updatedAt: new Date() })
    .where(eq(webinarSessions.id, sessionId));
  await recomputeWebinarDeliveryAnchor({
    campaignId,
    activityId,
    sessionDate: "2026-11-19",
    startTime: "14:00",
    timezone: "Europe/London",
    durationMinutes: 60,
  });
  const [updated] = await db
    .select()
    .from(scheduledInstances)
    .where(eq(scheduledInstances.ruleId, ruleId));
  assert.equal(updated.originalCalculatedAt.toISOString(), originalCalculatedAt);
  assert.notEqual(updated.calculatedAt.toISOString(), firstCalculatedAt);
  const history = await db
    .select()
    .from(scheduledInstanceHistory)
    .where(eq(scheduledInstanceHistory.scheduledInstanceId, updated.id));
  assert.equal(history.length, 1);
  assert.equal(history[0].previousCalculatedAt?.toISOString(), firstCalculatedAt);
});

test("a failed anchor calculation rolls back the webinar session insert", async () => {
  await db
    .insert(scheduleRules)
    .values({
      campaignId,
      activityId,
      anchorActivityId: activityId,
      offsetDays: 0,
      offsetMinutes: 0,
      direction: "after",
      businessDayStrategy: "calendar",
      audienceLocalTimezone: true,
      timezone: "Europe/London",
      targetSendTime: "not-a-time",
      enabled: true,
    });

  const response = await fetch(`${baseUrl}/campaigns/${campaignId}/webinars`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activityId,
      sessionDate: "2026-11-20",
      startTime: "14:00",
      durationMinutes: 60,
      timezone: "Europe/London",
      platform: "Planning platform",
      speakers: [{ name: "Rollback speaker" }],
      registrationRule: { suppressRecruitmentAfterRegistration: true },
    }),
  });
  assert.equal(response.status, 400);
  const sessions = await db
    .select()
    .from(webinarSessions)
    .where(and(eq(webinarSessions.activityId, activityId), eq(webinarSessions.sessionDate, "2026-11-20")));
  assert.equal(sessions.length, 0);
});