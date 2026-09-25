import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { webinarSessions } from "@workspace/db/schema/webinar";
import { webinarStandardCommunications, webinarStandardConfigs } from "@workspace/db/schema/webinar-standard";

/**
 * A content revision, not a wall-clock timestamp. Covers both session fields
 * and standard configuration/communications, without adding a schema column.
 * Read under the same transaction/lock as the guarded write.
 */
export async function webinarEditVersion(campaignId: string, sessionId: string, executor: any = db): Promise<string> {
  const [session] = await executor.select().from(webinarSessions).where(and(
    eq(webinarSessions.id, sessionId), eq(webinarSessions.campaignId, campaignId),
  ));
  if (!session) throw new Error("Webinar session not found");
  const [config] = await executor.select().from(webinarStandardConfigs).where(eq(webinarStandardConfigs.sessionId, sessionId));
  const rows = await executor.select().from(webinarStandardCommunications)
    .where(eq(webinarStandardCommunications.sessionId, sessionId))
    .orderBy(asc(webinarStandardCommunications.key));
  // ensureWebinarStandard refreshes row.updatedAt on reads even when the
  // schedule is unchanged. Do not count that housekeeping as an edit.
  const semantic = (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "createdAt" && key !== "updatedAt"));
  return createHash("sha256").update(JSON.stringify({
    session: semantic(session),
    config: config ? semantic(config) : null,
    rows: rows.map(semantic),
  })).digest("hex");
}

export const expectedWebinarVersion = /^[0-9a-f]{64}$/;

export class WebinarEditConflict extends Error {
  constructor() {
    super("Webinar changed since it was loaded; reload before saving");
    this.name = "WebinarEditConflict";
  }
}