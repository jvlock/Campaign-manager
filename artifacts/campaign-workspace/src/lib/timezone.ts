export function anchorAt(localDateTime: string, timezone: string): string | null {
  if (!localDateTime) return null;
  
  // localDateTime from datetime-local is YYYY-MM-DDTHH:mm
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(localDateTime);
  if (!match) return null;
  
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return null; // invalid timezone
  }
  
  const wallClockUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let anchor = new Date(wallClockUtc);
  
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(anchor).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    anchor = new Date(wallClockUtc - (localAsUtc - anchor.getTime()));
  }
  
  return Number.isNaN(anchor.getTime()) ? null : anchor.toISOString();
}

export function localDateTimeValue(instant: string | null | undefined, timezone: string): string {
  if (!instant) return '';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
    ) as Record<string, number>;
    
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  } catch {
    return '';
  }
}
