import {
  EVIDENCE_BASES, HIERARCHY_LEVELS, PRIMARY_RULE_TYPES, READINESS_STAGES,
  REQUIRED_RULE_FIELDS, RULE_COUNT, RULE_IDS, STANDARD_ID, STANDARD_VERSION,
  VALIDATION_METHODS,
  type CatalogIssueCode, type CatalogValidationIssue, type CatalogValidationResult,
  type WebinarStandardCatalog,
} from "./types";

type Location = readonly (string | number)[];
type DataRecord = Record<string, unknown>;
interface ArrayData {
  readonly length: number;
  readonly entries: ReadonlyMap<number, unknown>;
}

const ROOT_FIELDS = [
  "standardId", "standardVersion", "generatedAt", "ruleCount",
  "requiredFields", "note", "rules",
] as const;
const RULE_FIELDS = [...REQUIRED_RULE_FIELDS, "exceptionEligibleNote"] as const;
const ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  hierarchyLevel: HIERARCHY_LEVELS,
  primaryRuleType: PRIMARY_RULE_TYPES,
  evidenceBasis: EVIDENCE_BASES,
  readinessStage: READINESS_STAGES,
  validationMethod: VALIDATION_METHODS,
};
const KNOWN_IDS: ReadonlySet<string> = new Set(RULE_IDS);
const PLACEHOLDER = /\b(?:TBD|TODO|TBC|placeholder|lorem\s+ipsum)\b|^\s*(?:N\/A|not\s+specified)\s*$/i;
const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/** Never invokes caller-provided conversion methods or getters. */
function summarize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    return JSON.stringify(value.length > 160 ? `${value.slice(0, 160)}…` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value;
}

function validTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0)
    && Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
    && (match[8] === undefined || (Number(match[8]) <= 23 && Number(match[9]) <= 59))
    && Number.isFinite(Date.parse(value));
}

/** Called only on fresh, schema-validated copies, never on caller-owned objects. */
function freezeCopy<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeCopy(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Pure structural validation of the committed catalog contract.
 * File provenance and manifest/hash checks belong to the loader, not this function.
 */
export function validateWebinarStandardCatalog(input: unknown): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];
  const ruleIdsByIndex = new Map<number, string>();

  function issue(code: CatalogIssueCode, location: Location, message: string, value: unknown): void {
    const last = location[location.length - 1];
    const ruleIndex = location[0] === "rules" && typeof location[1] === "number"
      ? location[1] : undefined;
    issues.push({
      code, field: last === undefined ? "$" : String(last), message,
      valueSummary: summarize(value), location: [...location],
      ...(ruleIndex === undefined ? {} : { ruleIndex }),
    });
  }

  function descriptors(value: unknown, location: Location, array: boolean): PropertyDescriptorMap | undefined {
    try {
      if (value === null || typeof value !== "object" || Array.isArray(value) !== array) {
        issue("invalid_type", location, array ? "Expected an array." : "Expected a plain object.", value);
        return undefined;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        issue("invalid_type", location, "Exotic objects are not accepted as JSON data.", value);
        return undefined;
      }
      return Object.getOwnPropertyDescriptors(value);
    } catch {
      issue("invalid_type", location, "Object properties cannot be safely inspected.", value);
      return undefined;
    }
  }

  function record(value: unknown, location: Location, fields: readonly string[]): DataRecord | undefined {
    const properties = descriptors(value, location, false);
    if (!properties) return undefined;
    const copy: DataRecord = Object.create(null) as DataRecord;
    for (const key of Reflect.ownKeys(properties)) {
      const property: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(properties, key)?.value;
      const path = [...location, typeof key === "string" ? key : "[symbol]"];
      if (typeof key !== "string" || !fields.includes(key)) {
        issue("unknown_field", path, "Property is not part of the catalog schema.", key);
      }
      if (!property || !own(property, "value")) {
        issue("invalid_type", path, "Accessor properties are not accepted; getters are not executed.", undefined);
      } else if (typeof key === "string" && fields.includes(key)) {
        copy[key] = property.value as unknown;
      }
    }
    for (const key of fields) {
      if (!own(properties, key)) issue("missing_field", [...location, key], "Required property is missing.", undefined);
    }
    return copy;
  }

  function arrayData(value: unknown, location: Location): ArrayData | undefined {
    const properties = descriptors(value, location, true);
    if (!properties) return undefined;
    const length: unknown = properties.length?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
      issue("invalid_type", location, "Array length is invalid.", length);
      return undefined;
    }
    const entries = new Map<number, unknown>();
    for (const key of Reflect.ownKeys(properties)) {
      if (key === "length") continue;
      const numeric = typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      const path = [...location, numeric >= 0 ? numeric : typeof key === "string" ? key : "[symbol]"];
      const property: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(properties, key)?.value;
      if (numeric < 0 || numeric >= length) {
        issue("unknown_field", path, "Arrays may only contain indexed entries.", key);
      } else if (!property || !own(property, "value")) {
        issue("invalid_type", path, "Array accessors are not accepted; getters are not executed.", undefined);
      } else {
        entries.set(numeric, property.value as unknown);
      }
    }
    // Inspect present indices instead of iterating length: enormous sparse arrays
    // must fail safely without allocating or traversing billions of empty slots.
    if (entries.size !== length) {
      issue("invalid_value", location, "Array must be dense and contain only data properties.", value);
    }
    return { length, entries };
  }

  function text(value: unknown, location: Location): value is string {
    if (typeof value !== "string") {
      issue("invalid_type", location, "Expected a non-empty string.", value);
      return false;
    }
    if (value.trim().length === 0) issue("invalid_value", location, "String must not be empty or whitespace.", value);
    if (PLACEHOLDER.test(value)) issue("placeholder", location, "Prohibited placeholder text.", value);
    return true;
  }

  function finishFailure(): CatalogValidationResult {
    return freezeCopy({
      ok: false as const,
      issues: issues.map((entry) => {
        const ruleId = entry.ruleIndex === undefined ? undefined : ruleIdsByIndex.get(entry.ruleIndex);
        return { ...entry, ...(ruleId === undefined ? {} : { ruleId }) };
      }),
    });
  }

  const root = record(input, [], ROOT_FIELDS);
  if (!root) return finishFailure();
  for (const [key, expected] of [["standardId", STANDARD_ID], ["standardVersion", STANDARD_VERSION]] as const) {
    if (own(root, key) && text(root[key], [key]) && root[key] !== expected) {
      issue("invalid_value", [key], `Expected ${expected}.`, root[key]);
    }
  }
  if (own(root, "generatedAt") && text(root.generatedAt, ["generatedAt"]) && !validTimestamp(root.generatedAt)) {
    issue("invalid_value", ["generatedAt"], "Expected a valid ISO 8601 timestamp with a time-zone offset.", root.generatedAt);
  }
  if (own(root, "note")) text(root.note, ["note"]);
  if (own(root, "ruleCount")) {
    if (typeof root.ruleCount !== "number") issue("invalid_type", ["ruleCount"], "Expected a numeric rule count.", root.ruleCount);
    if (root.ruleCount !== RULE_COUNT) issue("invalid_rule_count", ["ruleCount"], `Declared rule count must be ${RULE_COUNT}.`, root.ruleCount);
  }

  const requiredCopy: unknown[] = [];
  if (own(root, "requiredFields")) {
    const required = arrayData(root.requiredFields, ["requiredFields"]);
    if (required) {
      if (required.length !== REQUIRED_RULE_FIELDS.length) {
        issue("invalid_value", ["requiredFields"], "Required-fields metadata must contain exactly twelve known keys.", required.length);
      }
      const seen = new Set<string>();
      for (const [index, value] of required.entries) {
        const path = ["requiredFields", index];
        if (text(value, path)) {
          if (!(REQUIRED_RULE_FIELDS as readonly string[]).includes(value)) {
            issue("invalid_enum", path, "Unknown required rule field.", value);
          }
          if (seen.has(value)) issue("invalid_value", path, "Required-fields metadata must not contain duplicates.", value);
          seen.add(value);
        }
        requiredCopy[index] = value;
      }
      for (const key of REQUIRED_RULE_FIELDS) {
        if (!seen.has(key)) issue("missing_field", ["requiredFields"], `Required-fields metadata is missing ${key}.`, key);
      }
    }
  }

  const rulesCopy: DataRecord[] = [];
  if (own(root, "rules")) {
    const rules = arrayData(root.rules, ["rules"]);
    if (rules) {
      if (rules.length !== RULE_COUNT) issue("invalid_rule_count", ["rules"], `Catalog must contain exactly ${RULE_COUNT} rules.`, rules.length);
      if (typeof root.ruleCount === "number" && root.ruleCount !== rules.length) {
        issue("invalid_rule_count", ["ruleCount"], "Declared count does not match the rules array length.", root.ruleCount);
      }
      const seenIds = new Set<string>();
      for (const [index, value] of rules.entries) {
        const rule = record(value, ["rules", index], RULE_FIELDS);
        if (!rule) continue;
        if (typeof rule.ruleId === "string") ruleIdsByIndex.set(index, rule.ruleId);
        for (const key of RULE_FIELDS) {
          if (!own(rule, key)) continue;
          const fieldValue = rule[key];
          const path = ["rules", index, key];
          if (key === "exceptionEligible") {
            if (typeof fieldValue !== "boolean") issue("invalid_type", path, "Expected a boolean; coercion is not permitted.", fieldValue);
          } else if (key === "exceptionEligibleNote" && fieldValue === null) {
            // Required supplemental property; null is its explicit permitted value.
          } else if (text(fieldValue, path)) {
            if (key === "ruleId") {
              if (!KNOWN_IDS.has(fieldValue)) issue("invalid_rule_id", path, "Rule ID is not in the committed catalog.", fieldValue);
              if (seenIds.has(fieldValue)) issue("duplicate_rule_id", path, "Rule ID must be unique.", fieldValue);
              seenIds.add(fieldValue);
            } else {
              const allowed = ENUM_FIELDS[key];
              if (allowed && !allowed.includes(fieldValue)) issue("invalid_enum", path, `Expected one of: ${allowed.join(", ")}.`, fieldValue);
            }
          }
        }
        rulesCopy[index] = { ...rule };
      }
    }
  }
  if (issues.length > 0) return finishFailure();

  // Every retained value has been validated above. These containers are all new;
  // no caller-owned object is retained or frozen, and no values are normalized.
  const catalog = {
    ...root, requiredFields: requiredCopy, rules: rulesCopy,
  } as unknown as WebinarStandardCatalog;
  return freezeCopy({ ok: true as const, catalog });
}