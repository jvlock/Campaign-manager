import type { StandardId, StandardVersion } from "../webinar-standard-catalog/types";
import type { RuleEvaluationResult } from "./types";

/** A caller-owned current snapshot, never an authenticated identity or execution permission. */
export interface SetupContext {
  readonly eventId: string;
  readonly snapshotId: string;
  readonly complete: boolean;
  readonly activityType: string | null;
  readonly evaluationStage?: string | null;
  readonly title?: string | null;
  readonly topic?: string | null;
  readonly description?: string | null;
  readonly intendedAudience?: string | null;
  readonly eventLocalDate?: string | null;
  readonly localStartTime?: string | null;
  readonly durationMinutes?: number | null;
  readonly timeZone?: string | null;
  readonly format?: "live" | "hybrid" | "simulated live" | "on-demand" | null;
  readonly platform?: string | null;
  readonly physicalLocation?: string | null;
  readonly registrationDestination?: string | null;
  readonly owner?: string | null;
  readonly recruitmentOwner?: string | null;
  readonly followUpOwner?: string | null;
  readonly primaryCta?: string | null;
  readonly followUpCta?: string | null;
  readonly measurementTargets?: readonly string[] | null;
  readonly registrationOpeningRule?: string | null;
  readonly registrationClosingRule?: string | null;
  readonly platformEnforcesCapacity?: boolean | null;
  readonly capacity?: number | null;
  /** Explicit audience assessment; no default language is invented by the evaluator. */
  readonly audienceNonDefaultLanguage?: boolean | null;
  readonly language?: string | null;
}

export interface MeasurementPlanContext {
  readonly eventId: string;
  readonly snapshotId: string;
  readonly complete: boolean;
  readonly description?: string | null;
  readonly targets?: readonly Readonly<{
    targetId: string;
    metric: string;
    target: number;
    unit: string;
  }>[] | null;
}

/** Results must describe this exact event snapshot and observation, not a cached readiness decision. */
export interface FindingEvidenceContext {
  readonly standardId: StandardId;
  readonly standardVersion: StandardVersion;
  readonly eventId: string;
  readonly snapshotId: string;
  readonly observedAtEpochMs: number;
  readonly complete: boolean;
  readonly setupResults?: readonly RuleEvaluationResult[];
  readonly ownerResults?: readonly RuleEvaluationResult[];
}