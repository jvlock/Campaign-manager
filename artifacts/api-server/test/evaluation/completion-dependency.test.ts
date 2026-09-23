import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAcyclicCompletionDependencyGraph, COMPLETION_DEPENDENCY_GRAPH, COMPLETION_SECTION_E_RULE_IDS, createCompletionDependencyGraph,
} from "../../src/lib/webinar-standard-evaluation/completion-done";
import { catalog } from "./fixtures";

test("published completion dependency graph is acyclic and DONE is terminal", () => {
  assert.doesNotThrow(() => assertAcyclicCompletionDependencyGraph(COMPLETION_DEPENDENCY_GRAPH));
  assert.equal(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-001"].includes("WEB-DONE-001"), false);
  assert.equal(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-002"].includes("WEB-DONE-001"), false);
  assert.equal(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-003"].includes("WEB-DONE-001"), false);
  assert.equal(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-004"].includes("WEB-DONE-001"), false);
  assert.equal(COMPLETION_DEPENDENCY_GRAPH["WEB-EXC-001"].includes("WEB-EXC-001"), false);
});

test("future dependency additions fail explicitly on direct and indirect cycles", () => {
  assert.throws(() => assertAcyclicCompletionDependencyGraph({ A: ["A"] }));
  assert.throws(() => assertAcyclicCompletionDependencyGraph({ A: ["B"], B: ["C"], C: ["A"] }));
});

test("catalog-derived DONE dependency set is every canonical rule except itself", () => {
  const graph = createCompletionDependencyGraph(catalog);
  assert.deepEqual(new Set(graph["WEB-DONE-001"]), new Set(
    catalog.rules.map(rule => rule.ruleId).filter(id => id !== "WEB-DONE-001"),
  ));
  assert.equal(graph["WEB-DONE-001"].length, 105);
  assertAcyclicCompletionDependencyGraph(graph);
});

test("static completion prerequisites are truthful and canonical", () => {
  assert.deepEqual(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-001"], ["WEB-FU-UNK-001", "WEB-FU-UNK-003"]);
  assert.deepEqual(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-002"], COMPLETION_SECTION_E_RULE_IDS);
  assert.ok(COMPLETION_SECTION_E_RULE_IDS.every(id => catalog.rules.some(rule => rule.ruleId === id)));
  assert.equal(COMPLETION_SECTION_E_RULE_IDS.includes("WEB-DONE-001" as never), false);
  assert.deepEqual(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-004"], ["WEB-SETUP-018"]);
  assert.ok(COMPLETION_DEPENDENCY_GRAPH["WEB-RDY-COMP-003"].includes("WEB-EXC-001"));
});