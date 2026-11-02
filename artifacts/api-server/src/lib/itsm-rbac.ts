export const ITSM_ROLES = ["N1", "N2", "N3", "N4", "N5"] as const;
export type ItsmRole = (typeof ITSM_ROLES)[number];
export type ItsmPermission =
  | "viewWorkspace"
  | "importExamples"
  | "saveWorkspace"
  | "createIncident"
  | "createProblem"
  | "createChange"
  | "manageTicket"
  | "manageConversations"
  | "appendAudit"
  | "resolveTicket"
  | "confirmClosure"
  | "approveCab"
  | "exportAudit"
  | "assignRole";

export type ItsmActor = {
  id: string;
  role: ItsmRole;
  serviceIds: string[];
};

const ROLE_NAMES: Record<ItsmRole, string> = {
  N1: "Direction",
  N2: "Analyste",
  N3: "SSI / support",
  N4: "Services d’appui",
  N5: "Auditeur temporaire",
};

export function isItsmRole(value: unknown): value is ItsmRole {
  return typeof value === "string" && ITSM_ROLES.includes(value as ItsmRole);
}

export function itsmRoleName(role: ItsmRole): string {
  return ROLE_NAMES[role];
}

export function metadataForItsmRoleChange<T extends object>(
  current: T,
  role: ItsmRole | null,
  serviceIds: readonly string[],
) {
  return {
    ...current,
    itsmRole: role,
    itsmServiceIds: role === null ? [] : [...new Set(serviceIds)],
    itsmBootstrapCompleted: true,
  };
}

export function metadataForItsmBootstrap<T extends object>(current: T) {
  return {
    ...current,
    itsmRole: "N1" as const,
    itsmServiceIds: [] as string[],
    itsmBootstrapCompleted: true,
  };
}

export function isBootstrapAdmin(
  email: string | undefined,
  verificationStatus: string | undefined,
  alreadyBootstrapped: boolean,
  configuredEmails: string | undefined,
): boolean {
  if (!email || verificationStatus !== "verified" || alreadyBootstrapped) return false;
  const allowlist = new Set((configuredEmails ?? "")
    .split(",")
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean));
  return allowlist.has(email.trim().toLocaleLowerCase("en-US"));
}

export function canPerform(
  actor: Pick<ItsmActor, "role" | "serviceIds">,
  permission: ItsmPermission,
  serviceId?: string | null,
): boolean {
  switch (permission) {
    case "viewWorkspace":
      return true;
    case "importExamples":
      return actor.role === "N1" || actor.role === "N2" || actor.role === "N3";
    case "saveWorkspace":
      return actor.role !== "N5";
    case "createIncident":
      return actor.role !== "N5";
    case "createProblem":
    case "createChange":
      return actor.role === "N3";
    case "manageTicket":
      return actor.role === "N3"
        || (actor.role === "N4" && Boolean(serviceId && actor.serviceIds.includes(serviceId)));
    case "manageConversations":
      return actor.role === "N1" || actor.role === "N2" || actor.role === "N3";
    case "appendAudit":
      return actor.role !== "N5";
    case "resolveTicket":
      return actor.role === "N3";
    case "confirmClosure":
      return actor.role !== "N5";
    case "approveCab":
      return actor.role === "N1"
        || (actor.role === "N3" && Boolean(serviceId && actor.serviceIds.includes(serviceId)));
    case "exportAudit":
      return actor.role === "N1" || actor.role === "N3" || actor.role === "N5";
    case "assignRole":
      return actor.role === "N1";
  }
}

export class ItsmAuthorizationError extends Error {
  constructor(message = "Cette action n’est pas autorisée pour votre rôle.") {
    super(message);
    this.name = "ItsmAuthorizationError";
  }
}

export function requirePermission(
  actor: Pick<ItsmActor, "role" | "serviceIds">,
  permission: ItsmPermission,
  serviceId?: string | null,
): void {
  if (!canPerform(actor, permission, serviceId)) throw new ItsmAuthorizationError();
}

export function canChangeItsmRole(
  actor: ItsmActor,
  targetUserId: string,
  currentRole: unknown,
  nextRole: unknown,
  activeAdminIds: readonly string[],
): nextRole is ItsmRole | null {
  if (actor.role !== "N1" || (nextRole !== null && !isItsmRole(nextRole))) return false;
  if (targetUserId === actor.id) {
    // Self-service is restricted to an explicit access removal, never promotion/demotion.
    if (nextRole !== null) return currentRole === "N1" && nextRole === "N1";
  }
  if (currentRole === "N1" && nextRole !== "N1") {
    return new Set(activeAdminIds).has(actor.id)
      && activeAdminIds.some((id) => id !== targetUserId);
  }
  return true;
}
