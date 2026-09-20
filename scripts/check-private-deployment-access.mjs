import assert from "node:assert/strict";
import test from "node:test";

// Run with the current published URL obtained from deployment metadata:
// node scripts/check-private-deployment-access.mjs https://your-app.replit.app
// No credentials, cookies, owner identities, or access tokens are supplied.
const target = new URL(process.argv[2]);
assert.equal(target.protocol, "https:");
assert.equal(target.pathname, "/");
assert.equal(target.search, "");
assert.equal(target.username, "");
assert.equal(target.password, "");

for (const path of ["/", "/api/campaigns"]) {
  test(`anonymous repeat access to ${path} stays behind the private publishing gate`, async () => {
    const requested = new URL(path, target);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(requested, {
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(20_000),
      });
      assert.equal(response.status, 307, "Expected the existing private-app redirect, not app access");
      const location = response.headers.get("location");
      assert.ok(location, "Private-app redirect must have a destination");
      const gate = new URL(location);
      assert.equal(gate.origin, "https://replit.com");
      assert.equal(gate.pathname, "/__replshield");
      assert.equal(gate.searchParams.get("redirect"), requested.href);
      await response.body?.cancel();
    }
  });
}