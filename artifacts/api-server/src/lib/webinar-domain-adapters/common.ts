import { Temporal } from "@js-temporal/polyfill";
import type { MappingIssue } from "./types";

export function issue(field: string, message: string, code = "INVALID_SOURCE"): MappingIssue {
  return { code, field, message, sourceReference: null };
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
/** ISO absolute instants only; epoch zero is a valid instant. No wall clock defaults. */
export function instant(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Instant must be safe integer milliseconds");
    return Temporal.Instant.fromEpochMilliseconds(value).epochMilliseconds;
  }
  return Temporal.Instant.from(value).epochMilliseconds;
}
/** Reject DST gaps AND overlaps instead of silently moving the local appointment. */
export function localScheduledInstant(date: string, time: string, timeZone: string): number {
  return Temporal.PlainDateTime.from(`${date}T${time}`, { overflow: "reject" })
    .toZonedDateTime(timeZone, { disambiguation: "reject" }).epochMilliseconds;
}
export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(node: unknown): void {
    if (node && typeof node === "object") {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
  }
  freeze(copy);
  return copy;
}