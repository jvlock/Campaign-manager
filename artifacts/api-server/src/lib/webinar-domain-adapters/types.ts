import type { EvaluationContext, ParticipantContext, CommunicationContext, EventOperationalStatus } from "../webinar-standard-evaluation/types";

/** Alias, not a parallel domain model. */
export type CanonicalEvaluationContext = EvaluationContext;
export type Classification = "directly-persisted" | "derived-deterministically" | "internal-service" | "external-unavailable" | "customer-data-prohibited" | "missing-incomplete" | "not-applicable";
export interface SourceReference { readonly sourceType: string; readonly sourceId: string }
export interface MappingIssue { readonly code: string; readonly field: string; readonly message: string; readonly sourceReference: SourceReference | null }
export interface InputGap { readonly field: string; readonly reason: string; readonly sourceReference: SourceReference | null }
export interface AdapterResult<T> {
  readonly value: T | null;
  readonly mappingErrors: readonly MappingIssue[];
}
export interface OccurrenceSource {
  readonly id: string; readonly campaignId: string; readonly activityId: string;
  readonly sessionDate: string; readonly startTime: string; readonly timezone: string;
  readonly durationMinutes: number; readonly platform: string; readonly name: string;
}
/** Explicit synthetic fixture, never a participant ingestion or database loader. */
export interface ParticipantSource extends Omit<ParticipantContext, "attendanceState"> {
  readonly isSynthetic: boolean;
  readonly attendanceState?: ParticipantContext["attendanceState"] | null;
  readonly registrationAtEpochMs?: number | null;
  readonly suppressed?: boolean | null;
}
export interface PlannedCommunicationSource {
  readonly id: string; readonly sessionId: string;
  readonly key: string;
  readonly scheduledAt?: string | number | null;
  readonly createdAt?: string | number | null;
  readonly recipientIds?: readonly string[];
  readonly utmRequired?: boolean | null;
}
export type Subcontexts = Pick<EvaluationContext, "setup" | "measurementPlan" | "findingEvidence" | "scheduling" | "audience" | "deliverables" | "governed" | "completionFollowUp" | "completionStage" | "completionSnapshot">;
export type BaseFacts = Pick<EvaluationContext, "registrationFlowTest" | "joinLinkOrVenueTest" | "consent" | "governance" | "followUp">;
export interface AssemblySource {
  readonly campaign: { readonly id: string };
  readonly activity: { readonly id: string; readonly campaignId: string; readonly activityType: string };
  readonly occurrence: OccurrenceSource;
  readonly binding: { readonly standardId: string; readonly standardVersion: string };
  readonly calculationInstant: string | number;
  readonly eventStatus: EventOperationalStatus | null;
  readonly participant?: ParticipantSource | null;
  readonly communications?: readonly PlannedCommunicationSource[];
  readonly subcontexts?: Subcontexts;
  readonly baseFacts?: Partial<BaseFacts>;
  readonly persisted?: PersistedApplicationRecords;
}
/** Explicit loaded application rows; no loading occurs in the mapper. */
export interface PersistedApplicationRecords {
  readonly activity: Readonly<Record<string, unknown>>;
  readonly communications: readonly Readonly<Record<string, unknown>>[];
  readonly applicationCommunications: readonly Readonly<Record<string, unknown>>[];
  readonly details: readonly Readonly<Record<string, unknown>>[];
  readonly destinations: readonly Readonly<Record<string, unknown>>[];
  readonly assets: readonly Readonly<Record<string, unknown>>[];
  readonly ctas: readonly Readonly<Record<string, unknown>>[];
  readonly communicationCtas: readonly Readonly<Record<string, unknown>>[];
  readonly communicationLandingPages: readonly Readonly<Record<string, unknown>>[];
  readonly landingPageAssets: readonly Readonly<Record<string, unknown>>[];
}
export interface AssemblyResult {
  readonly context: CanonicalEvaluationContext | null;
  readonly sourceReferences: readonly SourceReference[];
  readonly missingInputs: readonly InputGap[];
  readonly unavailableInputs: readonly InputGap[];
  readonly mappingErrors: readonly MappingIssue[];
  readonly classifications: readonly { readonly field: string; readonly classification: Classification }[];
}
export type { ParticipantContext, CommunicationContext };