import { createHash } from "node:crypto";
import { z } from "zod";
import type { OccurrenceSources } from "./webinar-evaluation-sources";
import { planningAccessMode } from "@workspace/db";

/** Synthetic contract v1 is a Campaign Manager test contract, NOT a Foundation API. */
export const observationTypes = ["taxonomy", "internal_title", "campaign_code", "utm", "objective_membership", "campaign_exclusion"] as const;
export type ObservationType = typeof observationTypes[number];
const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const scope = z.object({
  campaignId: z.string().uuid(), activityId: z.string().uuid(), occurrenceId: z.string().uuid(),
  communicationId: z.string().uuid().nullable(), destinationId: z.string().uuid().nullable(),
}).strict();
const value = z.union([token, z.null()]);
export const foundationRequestSchema = z.object({
  contract: z.literal("campaign-manager-synthetic-contract-v1"),
  type: z.enum(observationTypes), environment: z.literal("synthetic"),
  scope, input: z.object({
    activityTypeId: value, objectiveId: value, productFamilyId: value, audienceId: value,
    geographyId: value, industryId: value, channelId: value, communicationTypeId: value,
    contentId: value, languageId: value, eventDate: z.string().nullable(),
    destinationState: z.enum(["not_applicable", "missing", "ambiguous", "invalid", "valid"]),
    destinationUrl: z.string().url().max(2048).nullable(),
  }).strict(), inputFingerprint: hash, requestReference: token,
}).strict();
export type FoundationRequest = z.infer<typeof foundationRequestSchema>;
const taxonomyOutput = z.object({ id: token, label: z.string().min(1).max(200) }).strict();
const output = z.discriminatedUnion("type", [
  z.object({ type: z.literal("taxonomy"), classifications: z.array(taxonomyOutput).min(1).max(20) }).strict(),
  z.object({ type: z.literal("internal_title"), title: z.string().min(1).max(200), components: z.record(z.string(), z.string().min(1).max(200)).refine(v => Object.keys(v).length > 0) }).strict(),
  z.object({ type: z.literal("campaign_code"), code: token, reservation: z.literal("simulated") }).strict(),
  z.object({ type: z.literal("utm"), parameters: z.object({
    utm_source: token, utm_medium: token, utm_campaign: token,
  }).strict(), url: z.string().url().max(4096) }).strict(),
  z.object({ type: z.literal("objective_membership"), decision: z.boolean(), objectiveId: token }).strict(),
  z.object({ type: z.literal("campaign_exclusion"), decision: z.boolean(), audienceId: token }).strict(),
]);
export const foundationResponseSchema = z.object({
  status: z.enum(["success", "unavailable", "error", "partial"]),
  type: z.enum(observationTypes), environment: z.literal("synthetic"), scope,
  serviceId: token, serviceVersion: token, taxonomyVersion: token,
  requestReference: token, inputFingerprint: hash,
  respondedAt: timestamp, validFrom: timestamp, expiresAt: timestamp.nullable(),
  deprecated: z.boolean(), provenance: z.object({ adapter: z.literal("synthetic-contract"), reference: token }).strict(),
  warnings: z.array(token).max(20), errors: z.array(z.object({ code: token, retryAfterMs: z.number().int().min(0).max(2000).optional() }).strict()).max(10),
  output: output.nullable(),
}).strict();
export type FoundationResponse = z.infer<typeof foundationResponseSchema>;
export type FoundationFailure = "not_configured" | "unreachable" | "timeout" | "authentication" | "authorization" |
  "rate_limited" | "invalid_request" | "malformed_response" | "fingerprint_mismatch" | "unsupported_version" |
  "prohibited_environment" | "deprecated" | "expired" | "partial" | "conflict" | "internal_error" | "unavailable";
export class FoundationProviderError extends Error {
  readonly retryAfterMs?: number;
  retryCount = 0;
  constructor(readonly reason: FoundationFailure, retryAfterMs?: number) {
    super(reason);
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? Math.max(0, Math.min(2000, Math.floor(retryAfterMs!))) : undefined;
  }
}
export interface GovernanceFoundationProvider {
  readonly environment: "synthetic";
  readonly serviceVersion: string;
  readonly taxonomyVersion: string;
  request(input: FoundationRequest, signal: AbortSignal): Promise<unknown>;
}
export function foundationFingerprint(value: unknown): string {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`
    : JSON.stringify(v);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
const stable = (v: unknown): string | null => typeof v === "string" && token.safeParse(v).success ? v : null;
/** Only explicitly stored stable IDs; display labels, names and participant records never leave this builder. */
export function buildFoundationRequests(s: OccurrenceSources): FoundationRequest[] {
  const answers = s.activity.activity_answers && typeof s.activity.activity_answers === "object" && !Array.isArray(s.activity.activity_answers)
    ? s.activity.activity_answers as Record<string, unknown> : {};
  const common = {
    activityTypeId: stable(s.activity.activity_type_id), objectiveId: stable(answers.objectiveId),
    productFamilyId: stable(answers.productFamilyId), audienceId: stable(answers.audienceId),
    geographyId: stable(answers.geographyId), industryId: stable(answers.industryId),
    channelId: null, communicationTypeId: null, contentId: null, languageId: stable(answers.languageId),
    eventDate: typeof s.occurrence.session_date === "string" ? s.occurrence.session_date.slice(0, 10) : null,
    destinationState: "not_applicable" as const, destinationUrl: null,
  };
  const entries: { type: ObservationType; communicationId: string | null; destinationId: string | null; input: FoundationRequest["input"] }[] =
    (["taxonomy", "internal_title", "campaign_code", "objective_membership", "campaign_exclusion"] as const)
      .map(type => ({ type, communicationId: null, destinationId: null, input: common }));
  for (const communication of s.communications) {
    const app = s.applicationCommunications.find(c => c.id === communication.id);
    const links = s.communicationLandingPages.filter(c => c.communication_id === communication.id);
    const ids = [...new Set(links.map(c => stable(c.landing_page_id)).filter((id): id is string => !!id))];
    const destination = ids.length === 1 ? s.destinations.find(d => d.id === ids[0]) : null;
    const url = destination?.url;
    let valid = false;
    if (typeof url === "string" && /^https:\/\//i.test(url) && z.string().url().max(2048).safeParse(url).success) {
      const parsedUrl = new URL(url);
      valid = !parsedUrl.username && !parsedUrl.password
        && ![...parsedUrl.searchParams.keys()].some(k => /token|secret|key|auth|password/i.test(k));
    }
    entries.push({ type: "utm", communicationId: communication.id, destinationId: ids.length === 1 ? ids[0]! : null,
      input: { ...common, channelId: stable(app?.channel_id), communicationTypeId: stable(app?.type),
        contentId: null, destinationState: ids.length === 0 ? "missing" : ids.length > 1 ? "ambiguous"
          : valid ? "valid" : "invalid", destinationUrl: valid ? url as string : null } });
  }
  return entries.map(entry => {
    const body = { contract: "campaign-manager-synthetic-contract-v1" as const, type: entry.type,
      environment: "synthetic" as const, scope: { campaignId: s.campaign.id, activityId: s.activity.id,
        occurrenceId: s.occurrence.id, communicationId: entry.communicationId, destinationId: entry.destinationId },
      input: entry.input };
    const inputFingerprint = foundationFingerprint(body);
    return foundationRequestSchema.parse({ ...body, inputFingerprint, requestReference: `cm-${inputFingerprint}` });
  });
}
/** asOf is the immutable evaluation instant; receivedAt is transport receipt time.
 * A response may arrive after asOf, but never in the future relative to receipt.
 * Both the evaluation instant AND receipt must fall inside the asserted validity window. */
export function validateFoundationResponse(raw: unknown, request: FoundationRequest,
  versions: { serviceVersion: string; taxonomyVersion: string }, asOf: Date, receivedAt = asOf): FoundationResponse {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(raw); } catch { throw new FoundationProviderError("malformed_response"); }
  if (!encoded || encoded.length > 32768) throw new FoundationProviderError("malformed_response");
  const parsed = foundationResponseSchema.safeParse(raw);
  if (!parsed.success) throw new FoundationProviderError("malformed_response");
  const r = parsed.data;
  const allowedDiagnosticCodes = new Set(["synthetic-contract-only", "input_unavailable", "authentication",
    "authorization", "rate_limited", "invalid_request", "timeout", "unreachable", "internal_error"]);
  if (r.warnings.some(w => !allowedDiagnosticCodes.has(w)) || r.errors.some(e => !allowedDiagnosticCodes.has(e.code)))
    throw new FoundationProviderError("malformed_response");
  if (r.environment !== request.environment) throw new FoundationProviderError("prohibited_environment");
  if (r.type !== request.type || foundationFingerprint(r.scope) !== foundationFingerprint(request.scope)
    || r.requestReference !== request.requestReference) throw new FoundationProviderError("invalid_request");
  if (r.inputFingerprint !== request.inputFingerprint) throw new FoundationProviderError("fingerprint_mismatch");
  if (r.serviceVersion !== versions.serviceVersion || r.taxonomyVersion !== versions.taxonomyVersion) throw new FoundationProviderError("unsupported_version");
  if (r.deprecated) throw new FoundationProviderError("deprecated");
  const now = asOf.getTime(), received = receivedAt.getTime(), responseTime = Date.parse(r.respondedAt), from = Date.parse(r.validFrom);
  if (!Number.isFinite(now) || !Number.isFinite(received) || responseTime > received + 5000)
    throw new FoundationProviderError("invalid_request");
  if (from > now || from > received || r.expiresAt && (Date.parse(r.expiresAt) <= Math.max(now, received)
    || Date.parse(r.expiresAt) <= from)) throw new FoundationProviderError("expired");
  if (r.status === "partial") throw new FoundationProviderError("partial");
  if (r.status !== "success") {
    const code = r.errors[0]?.code;
    const mapped: Record<string, FoundationFailure> = { authentication: "authentication", authorization: "authorization",
      rate_limited: "rate_limited", invalid_request: "invalid_request", timeout: "timeout",
      unreachable: "unreachable", internal_error: "internal_error" };
    throw new FoundationProviderError(code && mapped[code] || (r.status === "unavailable" ? "unavailable" : "internal_error"),
      r.errors[0]?.retryAfterMs);
  }
  if (r.errors.length || !r.output || r.output.type !== r.type) throw new FoundationProviderError("partial");
  if (r.output.type === "taxonomy") {
    const selected = new Set(Object.entries(request.input).filter(([k]) => k.endsWith("Id"))
      .map(([, v]) => v).filter(Boolean));
    if (r.output.classifications.some(c => !selected.has(c.id))) throw new FoundationProviderError("invalid_request");
  }
  if (r.type === "utm") {
    const o = r.output as Extract<FoundationResponse["output"], { type: "utm" }>;
    if (request.input.destinationState !== "valid" || !request.input.destinationUrl) throw new FoundationProviderError("invalid_request");
    const outputUrl = new URL(o.url), destination = new URL(request.input.destinationUrl);
    if (outputUrl.origin !== destination.origin || outputUrl.pathname !== destination.pathname
      || outputUrl.username || outputUrl.password || outputUrl.hash !== destination.hash
      || [...destination.searchParams.keys()].some(k => k.startsWith("utm_"))
      || outputUrl.searchParams.size !== destination.searchParams.size + Object.keys(o.parameters).length
      || [...outputUrl.searchParams.keys()].some(k => outputUrl.searchParams.getAll(k).length !== 1)
      || [...destination.searchParams].some(([k, v]) => outputUrl.searchParams.get(k) !== v)
      || !Object.entries(o.parameters).every(([k, v]) => outputUrl.searchParams.get(k) === v))
      throw new FoundationProviderError("invalid_request");
  }
  if (r.output.type === "objective_membership" && r.output.objectiveId !== request.input.objectiveId
    || r.output.type === "campaign_exclusion" && r.output.audienceId !== request.input.audienceId) throw new FoundationProviderError("invalid_request");
  return r;
}

/** Only explicit server configuration and caller-provided fixtures; no invented business output. */
export class SyntheticContractAdapter implements GovernanceFoundationProvider {
  readonly environment = "synthetic";
  constructor(readonly serviceVersion: string, readonly taxonomyVersion: string,
    private readonly fixture: (input: FoundationRequest, signal: AbortSignal) => unknown | Promise<unknown>) {}
  async request(input: FoundationRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new FoundationProviderError("timeout");
    return new Promise((resolve, reject) => {
      const abort = () => reject(new FoundationProviderError("timeout"));
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => {
        if (signal.aborted) throw new FoundationProviderError("timeout");
        return this.fixture(input, signal);
      }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
    });
  }
}
let registeredSyntheticProvider: GovernanceFoundationProvider | null = null;
/** Server-only opt-in; the application installs no fixture by default. Not an HTTP connector. */
export function registerSyntheticFoundationProvider(provider: GovernanceFoundationProvider): void {
  if (planningAccessMode !== "open-development" || process.env.REPLIT_DEPLOYMENT
    || provider.environment !== "synthetic") throw new FoundationProviderError("prohibited_environment");
  registeredSyntheticProvider = provider;
}
export function configuredFoundationProvider(): GovernanceFoundationProvider | null {
  // No Foundation contract or approved fixture configuration is installed by default.
  return planningAccessMode === "open-development" && !process.env.REPLIT_DEPLOYMENT
    ? registeredSyntheticProvider : null;
}
/** Explicitly fixture-known key only. No naming/code/UTM/exclusion rules are implemented locally. */
export function bootstrapKnownSyntheticFixture(): void {
  if (process.env.GOVERNANCE_SYNTHETIC_CONTRACT !== "enabled") return;
  if (registeredSyntheticProvider) return;
  registerSyntheticFoundationProvider(knownSyntheticFixtureProvider());
}
export function knownSyntheticFixtureProvider(): SyntheticContractAdapter {
  return new SyntheticContractAdapter("synthetic-contract-v1", "synthetic-fixture-v1",
    (request, signal) => {
      if (signal.aborted) throw new FoundationProviderError("timeout");
      const now = new Date();
      const known = request.type === "taxonomy" && request.input.activityTypeId === "webinar";
      return { status: known ? "success" : "unavailable", type: request.type, environment: "synthetic",
        scope: request.scope, serviceId: "campaign-manager-synthetic-fixture",
        serviceVersion: "synthetic-contract-v1", taxonomyVersion: "synthetic-fixture-v1",
        requestReference: request.requestReference, inputFingerprint: request.inputFingerprint,
        respondedAt: now.toISOString(), validFrom: "2025-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T00:00:00.000Z", deprecated: false,
        provenance: { adapter: "synthetic-contract", reference: "known-webinar-fixture-v1" },
        warnings: ["synthetic-contract-only"], errors: known ? [] : [{ code: "input_unavailable" }],
        output: known ? { type: "taxonomy", classifications: [{ id: "webinar", label: "Webinar (synthetic fixture)" }] } : null };
    });
}