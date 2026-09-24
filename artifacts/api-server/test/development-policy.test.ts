import assert from "node:assert/strict";
import { test } from "node:test";
import { allowsDevelopmentPlanning } from "../src/lib/development-policy";

test("explicit planning allowlist retains ordinary workflows", () => {
  for (const [method, path] of [
    ["POST", "/campaigns"], ["PATCH", "/campaigns/c"], ["PUT", "/campaigns/c/map"],
    ["POST", "/campaigns/c/activities"], ["POST", "/campaigns/c/webinars"],
    ["PATCH", "/campaigns/c/webinars/w/standard"], ["POST", "/campaigns/c/communications"],
    ["POST", "/campaigns/c/schedule-rules/recompute"], ["POST", "/development/groups"],
    ["PUT", "/development/ownership/campaigns/c"], ["GET", "/development/calendar"],
    ["GET", "/campaigns/c/activities/a/task-settings"],
    ["PATCH", "/campaigns/c/activities/a/task-settings"],
    ["POST", "/development/simulations"],
    ["GET", "/development/simulations/context"],
  ]) assert.equal(allowsDevelopmentPlanning(method, path), true, path);
});
test("operational, authority, customer and unknown routes stay closed", () => {
  for (const [method, path] of [
    ["POST", "/campaigns/c/communications/i/release"], ["DELETE", "/campaigns/c/tasks/i"],
    ["POST", "/governance/approvals"], ["GET", "/campaigns/c/export/json"],
    ["GET", "/campaigns/c/webinars/w/standard/export"], ["POST", "/campaigns/c/webinars/w/people"],
    ["POST", "/integrations/send"], ["POST", "/evidence"], ["POST", "/new-route"],
    ["GET", "/organization/campaigns"], ["PATCH", "/task-defaults"],
    ["DELETE", "/campaigns/c/activities/a/task-settings"],
    ["POST", "/campaigns/c/activities/a/task-settings"],
    ["GET", "/development/simulations/other"],
  ]) assert.equal(allowsDevelopmentPlanning(method, path), false, path);
});

test("synthetic participant simulator exposes only scoped read and source-fact commands", () => {
  for (const path of ["context", "fixtures", "population", "history", "suppression"])
    assert.equal(allowsDevelopmentPlanning("GET", `/development/participants/${path}`), true);
  for (const path of ["fixtures", "transitions"])
    assert.equal(allowsDevelopmentPlanning("POST", `/development/participants/${path}`), true);
  for (const [method, path] of [
    ["POST", "/development/participants/population"], ["PATCH", "/development/participants/fixtures"],
    ["DELETE", "/development/participants/fixtures"], ["POST", "/development/participants/import"],
    ["POST", "/development/participants/send"], ["POST", "/development/participants/handoff"],
    ["PUT", "/development/participants/transitions"], ["GET", "/development/participants/transitions"],
    ["GET", "/development/participants/fixtures/arbitrary"], ["POST", "/development/participants/history"],
  ]) assert.equal(allowsDevelopmentPlanning(method, path), false, `${method} ${path}`);
});