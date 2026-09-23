import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorized, ORGANIZATION_ROLES, type PolicyGrant, type OrganizationAction } from "../../src/lib/organization/policy";

const principal = { userId: "alice", issuer: "trusted-test", subject: "alice" };
const resource = { type: "activity" as const, id: "activity-a", groupId: "a",
  resolved: true, groupActive: true, calendarVisible: true };
const planner: PolicyGrant = { role: "planner", groupId: "a", kind: "role" };
function permitted(action: OrganizationAction, grants: PolicyGrant[] = [planner], overrides = {}) {
  return isAuthorized({ principal, action, resource, memberships: ["a", "b", "team"],
    grants, ...overrides });
}
test("membership in B never carries A's planner action into B", () => {
  assert.equal(permitted("plan"), true);
  assert.equal(permitted("plan", [planner], { resource: { ...resource, groupId: "b" } }), false);
});
test("missing identity and unresolved ownership deny rather than infer from creator", () => {
  assert.equal(permitted("read", [planner], { principal: null }), false);
  assert.equal(permitted("read", [planner], { resource: { ...resource, resolved: false } }), false);
});
test("current membership is required despite old role grant", () => {
  assert.equal(permitted("plan", [planner], { memberships: ["b"] }), false);
});
test("parent calendar scope is a frozen explicit child set", () => {
  const calendar: PolicyGrant = { role: "read_only_viewer", kind: "calendar", groupId: "team", childGroupIds: ["a"] };
  assert.equal(permitted("calendar_summary", [calendar]), true);
  assert.equal(permitted("calendar_summary", [calendar], { resource: { ...resource, groupId: "new-child" } }), false);
  for (const action of ["read", "plan", "review", "execute", "participants", "financial"] as const)
    assert.equal(permitted(action, [calendar]), false, action);
});
test("private working drafts are never included in calendar", () => {
  const grant: PolicyGrant = { role: "read_only_viewer", kind: "calendar", groupId: "team", childGroupIds: ["a"] };
  assert.equal(permitted("calendar_summary", [grant], { resource: { ...resource, calendarVisible: false } }), false);
});
test("record collaboration never implies sibling, participant, review or execution access", () => {
  const collaboration: PolicyGrant = { role: "planner", kind: "collaboration", groupId: "b",
    resourceType: "activity", resourceId: "activity-a", actions: ["read", "plan"] };
  assert.equal(permitted("read", [collaboration]), true);
  assert.equal(permitted("read", [collaboration], { resource: { ...resource, id: "sibling" } }), false);
  for (const action of ["review", "participants", "execute", "financial"] as const)
    assert.equal(permitted(action, [collaboration]), false);
  assert.equal(permitted("read", []), false);
});
test("same authenticated person cannot approve across roles and groups", () => {
  const reviewer: PolicyGrant = { role: "independent_reviewer", kind: "role", groupId: "a" };
  assert.equal(permitted("review", [reviewer], { requesterUserId: "alice" }), false);
  assert.equal(permitted("review", [reviewer]), false);
  assert.equal(permitted("review", [reviewer], { requesterUserId: "bob" }), true);
});
for (const role of ORGANIZATION_ROLES) {
  test(`${role} cannot execute in the no-send foundation`, () => {
    assert.equal(permitted("execute", [{ role, kind: "role", groupId: "a" }]), false);
  });
}
test("administrator is not a detail viewer or independent reviewer", () => {
  const admin: PolicyGrant = { role: "administrator", kind: "role", groupId: "a" };
  assert.equal(permitted("administer", [admin]), true);
  assert.equal(permitted("read", [admin]), false);
  assert.equal(permitted("review", [admin], { requesterUserId: "bob" }), false);
});
test("archived scopes allow explicit historical reads but not new work", () => {
  const overrides = { resource: { ...resource, groupActive: false } };
  assert.equal(permitted("read", [planner], overrides), false);
  assert.equal(permitted("read", [{ ...planner, resourceType: "activity", resourceId: resource.id }], overrides), true);
  assert.equal(permitted("plan", [planner], overrides), false);
});
test("request-local inputs cannot contaminate concurrent policy evaluations", async () => {
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) =>
    Promise.resolve(permitted("plan", [planner], { memberships: i % 2 ? ["b"] : ["a"] }))));
  assert.deepEqual(results, Array.from({ length: 100 }, (_, i) => i % 2 === 0));
});