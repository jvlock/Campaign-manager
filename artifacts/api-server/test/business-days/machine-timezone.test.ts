import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const script = `
  import { addBusinessDays, shiftCalendarDays } from "./src/lib/webinar-standard-planning-time/index.ts";
  const instant = Date.parse("2025-03-07T14:00:00Z");
  process.stdout.write(JSON.stringify({
    calendar: shiftCalendarDays(instant, "America/New_York", 3),
    business: addBusinessDays(instant, "America/New_York", 1)
  }));
`;

function calculateInMachineZone(TZ: string): string {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, TZ },
    },
  );
}

test("explicit IANA calculations are independent from the machine TZ", () => {
  assert.equal(calculateInMachineZone("Pacific/Honolulu"), calculateInMachineZone("Asia/Tokyo"));
});