import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const folders = [
  "webinar-standard-planning-time",
  "webinar-standard-scheduling",
  "webinar-standard-audience",
] as const;
const pureExternal = new Set([
  "../webinar-standard-catalog/types",
  "../webinar-standard-catalog/validate",
  "../webinar-standard-catalog/rule-ids",
  "../webinar-standard-evaluation/types",
  "../webinar-standard-readiness/safe-data",
]);
const forbidden = new Set([
  "Date", "process", "require", "fetch", "XMLHttpRequest", "WebSocket",
  "EventSource", "Function", "eval", "globalThis", "global", "window",
  "document", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
  "performance", "crypto", "navigator", "localStorage", "sessionStorage",
  "Worker", "SharedWorker", "Deno", "Bun",
  "credentials", "apiKey", "accessToken", "secret", "sendEmail", "sendSms",
  "publish", "deploy", "executeSql", "router", "Now", "now",
]);

for (const folder of folders) {
  test(`${folder}: production dependency graph and types expose planning capabilities only`, async () => {
    const root = new URL("../../src/lib/", import.meta.url);
    const directory = new URL(`${folder}/`, root);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".ts")).sort();
    assert.ok(files.length > 0, "Planning module must exist");
    for (const filename of files) {
      const source = ts.createSourceFile(filename, await readFile(new URL(filename, directory), "utf8"),
        ts.ScriptTarget.Latest, true);
      const dependency = (target: string): void => {
        if (target === "@js-temporal/polyfill") {
          assert.ok(folder === "webinar-standard-planning-time"
            && ["time.ts", "business-days.ts"].includes(filename),
          "Temporal is isolated behind explicit-time helpers");
          return;
        }
        if (pureExternal.has(target)) return;
        if (target.startsWith("./")) {
          assert.ok(files.includes(`${target.slice(2)}.ts`), `Unreviewed local dependency: ${target}`);
          return;
        }
        assert.ok(folders.some((allowed) => target.startsWith(`../${allowed}/`)),
          `Forbidden dependency: ${target}`);
      };
      const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
          assert.ok(ts.isStringLiteral(node.moduleSpecifier));
          const target = node.moduleSpecifier.text;
          dependency(target);
          if (target === "../webinar-standard-evaluation/types") {
            assert.ok(ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly,
              "Existing evaluator context may only be imported as types");
          }
        }
        if (ts.isImportTypeNode(node)) {
          assert.ok(ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal));
          dependency(node.argument.literal.text);
        }
        assert.ok(!ts.isImportEqualsDeclaration(node), "No import aliases with runtime loading");
        if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node)) {
          assert.ok(!forbidden.has(node.text), `${folder}/${filename}: forbidden capability ${node.text}`);
          if (node.text === "Math") {
            assert.ok(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node
              && node.parent.name.text !== "random", "No random generation or Math aliasing");
          }
          if (node.text === "Temporal" && !ts.isImportSpecifier(node.parent)) {
            const member = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node
              ? node.parent.name.text : ts.isQualifiedName(node.parent) && node.parent.left === node
                ? node.parent.right.text : null;
            assert.ok(member && ["Instant", "ZonedDateTime", "PlainDateTime", "PlainDate", "PlainTime"].includes(member),
            "No ambient Temporal clock or namespace escape");
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });
}