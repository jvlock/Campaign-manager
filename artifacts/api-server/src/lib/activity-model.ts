export const GOVERNED_CHANNELS = [
  { id: "psg", displayName: "Paid Search: Google", type: "paid" },
  { id: "psl", displayName: "Paid Social: LinkedIn", type: "paid" },
  { id: "disp", displayName: "Display", type: "paid" },
  { id: "orglin", displayName: "Organic Social: LinkedIn", type: "organic" },
  { id: "adv", displayName: "Advocacy Social", type: "organic" },
  { id: "eml", displayName: "Email: Pardot", type: "email" },
  { id: "emlc", displayName: "Email: Certain", type: "email" },
  { id: "emlp", displayName: "Email: Partner", type: "email" },
  { id: "evlv", displayName: "Event: In-Person", type: "event" },
  { id: "evind", displayName: "Event: Industry", type: "event" },
  { id: "evvrt", displayName: "Event: Virtual On24", type: "event" },
  { id: "app", displayName: "In-App", type: "app" },
  { id: "mcp", displayName: "MCP", type: "app" },
] as const;

export type RequiredField = { key: string; options?: readonly string[] };
export type ActivityTypeConfiguration = {
  id: string;
  displayName: string;
  namingTemplate: string;
  requiredFields: readonly RequiredField[];
  allowedOverrides: readonly string[];
};

const universal = ["deliveryStartDate", "deliveryEndDate", "productValueIds", "region", "language"] as const;
const paidFields = ["objective", "campaign", "audienceOrAdGroup", "creative", "placement", "platformId", "landingPage"] as const;
const overrides = (...extra: string[]) => [...universal, ...extra];
const fields = (...keys: readonly string[]): RequiredField[] => keys.map((key) => ({ key }));

export const MCP_INTENTS = ["awareness", "consideration", "evaluation", "conversion", "retention"] as const;
export const CAMPAIGN_INHERITANCE_KEYS = [
  "deliveryStartDate", "deliveryEndDate", "productValueIds", "owner", "region",
  "language", "primaryCta", "landingDestination",
] as const;

export const ACTIVITY_TYPE_CONFIGURATIONS: readonly ActivityTypeConfiguration[] = [
  { id: "email", displayName: "Email", namingTemplate: "{campaign}-{activityType}-{name}", requiredFields: [{ key: "emailType", options: ["activation", "nurture", "newsletter", "campaign", "event invitation", "post-event", "single CTA"] }], allowedOverrides: overrides("owner", "primaryCta", "landingDestination") },
  { id: "paid-search", displayName: "Paid Search", namingTemplate: "{campaign}-paid-search-{name}", requiredFields: fields(...paidFields), allowedOverrides: overrides("landingDestination") },
  { id: "paid-social", displayName: "Paid Social", namingTemplate: "{campaign}-paid-social-{name}", requiredFields: fields(...paidFields), allowedOverrides: overrides("landingDestination") },
  { id: "display-content-partnerships", displayName: "Display & Content Partnerships", namingTemplate: "{campaign}-display-{name}", requiredFields: fields("campaign", "audienceOrAdGroup", "creative", "placement", "platformId", "objective", "landingPage"), allowedOverrides: overrides("landingDestination") },
  { id: "organic-social", displayName: "Organic Social", namingTemplate: "{campaign}-organic-{name}", requiredFields: fields("socialFormat"), allowedOverrides: overrides() },
  { id: "employee-advocacy", displayName: "Employee Advocacy", namingTemplate: "{campaign}-advocacy-{name}", requiredFields: fields("advocacyProgram"), allowedOverrides: overrides() },
  { id: "events", displayName: "Events", namingTemplate: "{campaign}-{eventType}-{name}", requiredFields: [{ key: "eventType", options: ["event series", "individual event", "registration source", "attendance", "no-show", "handraiser", "follow-up"] }], allowedOverrides: overrides("owner") },
  { id: "sales-cadences", displayName: "Sales Cadences", namingTemplate: "{campaign}-{salesType}-{name}", requiredFields: [{ key: "salesType", options: ["prospecting", "handraiser recovery", "event follow-up", "account expansion", "cross-sell", "renewal support", "executive outreach"] }], allowedOverrides: overrides("owner") },
  { id: "in-app", displayName: "In-App", namingTemplate: "{campaign}-in-app-{name}", requiredFields: fields("placement"), allowedOverrides: overrides("primaryCta") },
  { id: "mcp", displayName: "MCP", namingTemplate: "{campaign}-mcp-{intentCategory}", requiredFields: [{ key: "intentCategory", options: MCP_INTENTS }], allowedOverrides: overrides() },
  { id: "website", displayName: "Website", namingTemplate: "{campaign}-web-{name}", requiredFields: fields("pageType"), allowedOverrides: overrides("primaryCta", "landingDestination") },
  { id: "partner-marketing", displayName: "Partner Marketing", namingTemplate: "{campaign}-partner-{name}", requiredFields: fields("partner"), allowedOverrides: overrides("primaryCta") },
] as const;

export class ActivityModelError extends Error {
  constructor(public field: string, public code: string, message: string) {
    super(message);
    this.name = "ActivityModelError";
  }
}

export function assertMcpSafe(value: unknown, path = "data"): void {
  const prohibited = (candidate: string) => {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized.includes("rawprompt") || normalized.includes("prompttext") || normalized.includes("promptvalue");
  };
  if (typeof value === "string" && prohibited(value)) {
    throw new ActivityModelError(path, "mcp_prompt_data_prohibited", `${path} contains prohibited prompt data`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMcpSafe(entry, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (prohibited(key)) throw new ActivityModelError(`${path}.${key}`, "mcp_prompt_data_prohibited", `${path}.${key} is a prohibited prompt field`);
      assertMcpSafe(entry, `${path}.${key}`);
    }
  }
}

export function normalizeCampaignInheritance(
  current: unknown,
  update: unknown,
): Record<string, unknown> {
  const existing = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown> : {};
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new ActivityModelError("inheritance", "invalid_type", "inheritance must be an object");
  }
  const incoming = update as Record<string, unknown>;
  for (const key of Object.keys(incoming)) {
    if (!(CAMPAIGN_INHERITANCE_KEYS as readonly string[]).includes(key)) {
      throw new ActivityModelError(`inheritance.${key}`, "unknown_inheritance_field", `Unknown campaign inheritance field: ${key}`);
    }
  }
  const result = Object.fromEntries(CAMPAIGN_INHERITANCE_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(existing, key))
    .map((key) => [key, existing[key]]));
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "productValueIds") {
      if (value !== null && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
        throw new ActivityModelError(`inheritance.${key}`, "invalid_type", "productValueIds must be an array of strings or null");
      }
    } else if (key === "deliveryStartDate" || key === "deliveryEndDate") {
      const parsed = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : null;
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)) {
        throw new ActivityModelError(`inheritance.${key}`, "invalid_date", `${key} must use YYYY-MM-DD or null`);
      }
    } else if (value !== null && typeof value !== "string") {
      throw new ActivityModelError(`inheritance.${key}`, "invalid_type", `${key} must be a string or null`);
    }
    result[key] = value;
  }
  return result;
}

export function renderActivityName(
  template: string,
  builtins: Record<string, unknown>,
  answers: Record<string, unknown>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_placeholder, key: string) => {
    const inAnswers = Object.prototype.hasOwnProperty.call(answers, key);
    const inBuiltins = Object.prototype.hasOwnProperty.call(builtins, key);
    const value = inAnswers ? answers[key] : inBuiltins ? builtins[key] : undefined;
    if (value === undefined) throw new ActivityModelError(key, "unknown_placeholder", `Unknown naming placeholder: ${key}`);
    if (value === null) throw new ActivityModelError(key, "null_placeholder", `Naming placeholder ${key} cannot be null`);
    if (typeof value === "object") throw new ActivityModelError(key, "object_placeholder", `Naming placeholder ${key} must be a primitive value`);
    return String(value);
  });
}

export function activityConfiguration(id: string): ActivityTypeConfiguration {
  const configuration = ACTIVITY_TYPE_CONFIGURATIONS.find((item) => item.id === id);
  if (!configuration) throw new ActivityModelError("activityTypeId", "unknown_activity_type", `Unknown activity type: ${id}`);
  return configuration;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActivityModelError(field, "invalid_type", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export type ValidatedActivityModel = {
  configuration: ActivityTypeConfiguration;
  answers: Record<string, unknown>;
  overrides: Record<string, unknown>;
  generatedName: string;
  effectiveInheritance: Record<string, unknown>;
};

export function validateActivityModel(input: {
  activityTypeId: unknown;
  name: unknown;
  answers: unknown;
  overrides?: unknown;
  campaignName: string;
  inherited: Record<string, unknown>;
}): ValidatedActivityModel {
  if (typeof input.activityTypeId !== "string") throw new ActivityModelError("activityTypeId", "required", "activityTypeId is required");
  const configuration = activityConfiguration(input.activityTypeId);
  const answers = record(input.answers, "answers");
  const activityName = input.name;
  if (configuration.id !== "mcp" && (typeof activityName !== "string" || activityName === "")) {
    throw new ActivityModelError("name", "required", "name is required");
  }
  for (const required of configuration.requiredFields) {
    const value = answers[required.key];
    if (value === undefined || value === null || value === "" || typeof value === "object") {
      throw new ActivityModelError(required.key, "required", `${required.key} is required for ${configuration.id}`);
    }
    if (required.options && (!required.options.includes(String(value)))) {
      throw new ActivityModelError(required.key, "invalid_option", `${required.key} must be one of: ${required.options.join(", ")}`);
    }
  }
  const activityOverrides = input.overrides === undefined ? {} : record(input.overrides, "overrides");
  for (const key of Object.keys(activityOverrides)) {
    if (!configuration.allowedOverrides.includes(key)) {
      throw new ActivityModelError(`overrides.${key}`, "override_not_allowed", `${key} cannot be overridden for ${configuration.id}`);
    }
    const value = activityOverrides[key];
    if (key === "productValueIds") {
      if (value !== null && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
        throw new ActivityModelError(`overrides.${key}`, "invalid_type", "productValueIds must be an array of strings or null");
      }
    } else if (key === "deliveryStartDate" || key === "deliveryEndDate") {
      const parsed = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : null;
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)) {
        throw new ActivityModelError(`overrides.${key}`, "invalid_date", `${key} must use YYYY-MM-DD or null`);
      }
    } else if (value !== null && typeof value !== "string") {
      throw new ActivityModelError(`overrides.${key}`, "invalid_type", `${key} must be a string or null`);
    }
  }
  const effectiveInheritance = Object.fromEntries(configuration.allowedOverrides.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(activityOverrides, key) ? activityOverrides[key] : input.inherited[key],
  ]));
  const generatedName = renderActivityName(configuration.namingTemplate, {
    campaign: input.campaignName,
    activityType: configuration.id,
    name: activityName,
  }, answers);
  if (configuration.id === "mcp") {
    assertMcpSafe({
      answers, overrides: activityOverrides, effectiveInheritance, name: activityName,
      campaignName: input.campaignName, generatedName,
    }, "activity");
  }
  return { configuration, answers, overrides: activityOverrides, generatedName, effectiveInheritance };
}

export function assertCatalogIntegrity(): void {
  const fixturePrefixes = ["future-channel-", "conditional-", "activation-orchestrator-", "task14-governed-"];
  for (const configuration of ACTIVITY_TYPE_CONFIGURATIONS) {
    if (fixturePrefixes.some((prefix) => configuration.id.startsWith(prefix))) {
      throw new ActivityModelError("activityTypeId", "fixture_configuration", `Test fixture configuration cannot be published: ${configuration.id}`);
    }
    if (configuration.id === "mcp") {
      assertMcpSafe(configuration, "configuration");
      const intent = configuration.requiredFields.find((field) => field.key === "intentCategory");
      if (!intent || JSON.stringify(intent.options) !== JSON.stringify(MCP_INTENTS)) {
        throw new ActivityModelError("intentCategory", "invalid_mcp_intents", "MCP must define the five governed intent options");
      }
    }
  }
}

assertCatalogIntegrity();