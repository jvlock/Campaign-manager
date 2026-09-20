export const FINAL_CODE_ISSUANCE_MESSAGE =
  "Final code issuance is not currently available pending remediation of the source governance system.";

export const PROVISIONAL_GOVERNANCE = Object.freeze({
  label: "PROVISIONAL / DRAFT — NOT GOVERNANCE APPROVED",
  sourceEnvironment: "development",
  verificationStatus: "provisional",
  governanceApproved: false,
  publishingEligible: false,
  requiresBusinessValidation: true,
  externalPublishing: false,
  externalSending: false,
  finalCodeIssuanceAvailable: false,
  message: FINAL_CODE_ISSUANCE_MESSAGE,
});

export class GovernanceQuarantineError extends Error {
  readonly status = 409;
  readonly code = "final_code_issuance_unavailable";

  constructor(public readonly field: string) {
    super(FINAL_CODE_ISSUANCE_MESSAGE);
    this.name = "GovernanceQuarantineError";
  }
}

const FINALITY_KEYS = new Set([
  "approvalstatus", "governancestatus", "issuancestatus", "finality",
  "final", "isfinal", "approved", "isapproved", "governanceapproved",
  "official", "isofficial", "publishingeligible", "publishexternally",
  "externalpublishing", "sendexternally", "externalsending",
]);

function asksForFinality(key: string, value: unknown): boolean {
  const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
  const normalizedValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["status", "mode"].includes(normalizedKey)) {
    return ["approved", "final", "official"].includes(normalizedValue);
  }
  if (!FINALITY_KEYS.has(normalizedKey)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["approved", "final", "official", "published", "publish", "true", "yes"].includes(normalizedValue);
}

/** Inspect control fields only; ordinary draft copy may contain these words. */
export function assertNoFinalityRequest(
  value: unknown,
  path = "body",
  options: { recurseArrays?: boolean } = {},
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (options.recurseArrays !== false) {
      value.forEach((entry, index) => assertNoFinalityRequest(entry, `${path}[${index}]`, options));
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (asksForFinality(key, entry)) throw new GovernanceQuarantineError(`${path}.${key}`);
    if (entry && typeof entry === "object") {
      assertNoFinalityRequest(entry, `${path}.${key}`, options);
    }
  }
}

export function assertNoSourceMetadataEscalation(value: unknown, path = "sourceMetadata"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
    const normalizedValue = typeof entry === "string" ? entry.trim().toLowerCase() : entry;
    const escalates =
      (normalizedKey === "sourceenvironment" && normalizedValue === "production")
      || (normalizedKey === "verificationstatus" && ["verified", "approved", "final"].includes(String(normalizedValue)))
      || (normalizedKey === "publishingeligible" && (normalizedValue === true || normalizedValue === "true"))
      || (normalizedKey === "governanceapproved" && (normalizedValue === true || normalizedValue === "true"));
    if (escalates) throw new GovernanceQuarantineError(`${path}.${key}`);
  }
}

export function quarantineApprovalResponse<T extends Record<string, unknown>>(approval: T): T & {
  status: "provisional";
  governanceApproved: false;
  approvalEffective: false;
  quarantine: typeof PROVISIONAL_GOVERNANCE;
} {
  return {
    ...approval,
    status: "provisional",
    governanceApproved: false,
    approvalEffective: false,
    quarantine: PROVISIONAL_GOVERNANCE,
  };
}