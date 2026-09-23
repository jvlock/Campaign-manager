import { Temporal } from "@js-temporal/polyfill";
import {
  assertInstant,
  assertTimeZone,
  shiftCalendarDays,
  type CalendarShift,
} from "./time";

const MAX_BUSINESS_DAYS = 100_000;

export const BUSINESS_DAY_CONVENTION = Object.freeze({
  weekdays: Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const),
  isoWeekdays: Object.freeze([1, 2, 3, 4, 5] as const),
  noHolidayCalendar: true,
  timeZoneBasis: "supplied IANA time zone",
  preservesLocalWallClockTime: true,
  maximumBusinessDays: MAX_BUSINESS_DAYS,
} as const);

export function addBusinessDays(
  epochMs: number,
  timeZone: string,
  days: number,
): CalendarShift {
  const validEpochMs = assertInstant(epochMs, "epochMs");
  const zone = assertTimeZone(timeZone);
  if (!Number.isInteger(days) || days < 0 || days > MAX_BUSINESS_DAYS) {
    throw new RangeError(
      `days must be a nonnegative integer no greater than ${MAX_BUSINESS_DAYS}.`,
    );
  }

  let date = Temporal.Instant
    .fromEpochMilliseconds(validEpochMs)
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  let calendarDays = 0;
  let businessDays = 0;
  while (businessDays < days) {
    try {
      date = date.add({ days: 1 }, { overflow: "reject" });
    } catch {
      throw new RangeError("Business-day shift is outside the Temporal range.");
    }
    calendarDays += 1;
    if (date.dayOfWeek <= 5) businessDays += 1;
  }

  return shiftCalendarDays(validEpochMs, zone, calendarDays);
}