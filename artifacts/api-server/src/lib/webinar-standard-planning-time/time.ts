import { Temporal } from "@js-temporal/polyfill";

export type CalendarShift = Readonly<{
  epochMs: number;
  localDate: string;
  localTime: string;
  offset: string;
  disambiguation: "none" | "gap_forward" | "overlap_earlier";
  requestedLocalDateTime: string;
}>;

type Disambiguation = "compatible" | "earlier" | "later";

export function assertInstant(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a finite safe-integer epoch millisecond instant.`);
  }

  try {
    Temporal.Instant.fromEpochMilliseconds(value);
  } catch {
    throw new RangeError(`${field} is outside the Temporal instant range.`);
  }
  return value;
}

export function assertTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("timeZone must be a named IANA time zone.");
  }
  if (/^(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) {
    throw new RangeError("timeZone must be a named IANA time zone, not a bare offset.");
  }

  try {
    Temporal.ZonedDateTime.from({
      timeZone: value,
      year: 2000,
      month: 1,
      day: 1,
      hour: 0,
    }, { overflow: "reject" });
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${value}.`);
  }
  return value;
}

export function localTime(
  epochMs: number,
  timeZone: string,
): Readonly<{ date: string; time: string; offset: string }> {
  const instant = Temporal.Instant.fromEpochMilliseconds(assertInstant(epochMs, "epochMs"));
  const zoned = instant.toZonedDateTimeISO(assertTimeZone(timeZone));
  return Object.freeze({
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString(),
    offset: zoned.offset,
  });
}

function atLocalTime(
  local: Temporal.PlainDateTime,
  timeZone: string,
  disambiguation: Disambiguation,
): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from({
    timeZone,
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
    second: local.second,
    millisecond: local.millisecond,
    microsecond: local.microsecond,
    nanosecond: local.nanosecond,
  }, { disambiguation, overflow: "reject" });
}

export function shiftCalendarDays(
  epochMs: number,
  timeZone: string,
  days: number,
): CalendarShift {
  const instant = Temporal.Instant.fromEpochMilliseconds(assertInstant(epochMs, "epochMs"));
  const zone = assertTimeZone(timeZone);
  if (!Number.isSafeInteger(days)) {
    throw new TypeError("days must be a safe integer.");
  }

  const source = instant.toZonedDateTimeISO(zone);
  let requested: Temporal.PlainDateTime;
  try {
    requested = source.toPlainDate()
      .add({ days }, { overflow: "reject" })
      .toPlainDateTime(source.toPlainTime());
  } catch {
    throw new RangeError("Calendar-day shift is outside the Temporal range.");
  }

  const earlier = atLocalTime(requested, zone, "earlier");
  const later = atLocalTime(requested, zone, "later");
  const compatible = atLocalTime(requested, zone, "compatible");
  const isAmbiguous = earlier.epochNanoseconds !== later.epochNanoseconds;
  const disambiguation: CalendarShift["disambiguation"] = !isAmbiguous
    ? "none"
    : compatible.epochNanoseconds === later.epochNanoseconds
      ? "gap_forward"
      : "overlap_earlier";

  return Object.freeze({
    epochMs: Number(compatible.epochMilliseconds),
    localDate: compatible.toPlainDate().toString(),
    localTime: compatible.toPlainTime().toString(),
    offset: compatible.offset,
    disambiguation,
    requestedLocalDateTime: requested.toString(),
  });
}

export function calendarDaysBetween(
  fromEpochMs: number,
  toEpochMs: number,
  timeZone: string,
): number {
  const zone = assertTimeZone(timeZone);
  const from = Temporal.Instant
    .fromEpochMilliseconds(assertInstant(fromEpochMs, "fromEpochMs"))
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  const to = Temporal.Instant
    .fromEpochMilliseconds(assertInstant(toEpochMs, "toEpochMs"))
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  return from.until(to, { largestUnit: "day" }).days;
}