/** Identity supplied only by the app's trusted server-side verifier, never HTTP claims. */
export interface VerifiedPrincipal {
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
}

export const ORGANIZATION_ROLES = [
  "planner", "exception_requester", "independent_reviewer",
  "operations_executor", "administrator", "read_only_viewer",
] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
export type OrganizationAction =
  | "read" | "plan" | "submit_evidence" | "request_exception" | "review"
  | "administer" | "calendar_summary" | "participants" | "financial" | "execute";

const actions: Record<OrganizationRole, readonly OrganizationAction[]> = {
  planner: ["read", "plan", "submit_evidence"],
  exception_requester: ["read", "request_exception"],
  independent_reviewer: ["read", "review"],
  operations_executor: ["read"],
  administrator: ["administer"],
  read_only_viewer: ["read", "calendar_summary"],
};

export class OrganizationAccessError extends Error {
  readonly status = 403;
  constructor() { super("Organization access denied"); }
}

export function deny(): never { throw new OrganizationAccessError(); }

export interface PolicyGrant {
  role: OrganizationRole;
  actions?: readonly OrganizationAction[];
  groupId: string;
  scopeGroupId?: string;
  resourceType?: "campaign" | "activity";
  resourceId?: string;
  kind: "role" | "collaboration" | "calendar";
  /** Explicit snapshot, not a dynamic descendant query. */
  childGroupIds?: readonly string[];
}
export interface PolicyResource {
  type: "campaign" | "activity";
  id: string;
  groupId: string;
  resolved: boolean;
  groupActive: boolean;
  calendarVisible: boolean;
}

/** Pure policy receives fresh authoritative facts; it is not an identity verifier. */
export function isAuthorized(input: {
  principal: VerifiedPrincipal | null;
  action: OrganizationAction;
  resource: PolicyResource;
  memberships: readonly string[];
  grants: readonly PolicyGrant[];
  requesterUserId?: string;
}): boolean {
  const { principal, action, resource, memberships, grants } = input;
  if (!principal || !resource.resolved || action === "execute") return false;
  if (action === "review" && (!input.requesterUserId || input.requesterUserId === principal.userId)) return false;
  if (!resource.groupActive && action !== "read" && action !== "calendar_summary") return false;
  return grants.some(grant => {
    if (!memberships.includes(grant.groupId)) return false;
    if (grant.kind === "calendar") {
      return action === "calendar_summary" && resource.calendarVisible
        && grant.childGroupIds?.includes(resource.groupId) === true;
    }
    if (grant.kind === "collaboration") {
      return (resource.groupActive || action === "read") && grant.resourceId === resource.id
        && grant.resourceType === resource.type
        && ["read", "plan", "submit_evidence"].includes(action)
        && grant.actions?.includes(action) === true;
    }
    if ((grant.scopeGroupId ?? grant.groupId) !== resource.groupId) return false;
    // Archival/restricted staffing is not a blanket continuation of workspace access.
    // Historical detail requires an explicit record grant; calendar has its own grant.
    if (!resource.groupActive && !grant.resourceId) return false;
    if (grant.resourceId && (grant.resourceId !== resource.id || grant.resourceType !== resource.type)) return false;
    if (action === "calendar_summary" && !resource.calendarVisible) return false;
    return actions[grant.role]?.includes(action) === true
      && (!grant.actions || grant.actions.includes(action));
  });
}