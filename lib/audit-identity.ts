export type AuditIdentitySession =
  | { actor: "admin" }
  | { actor: "user"; email: string }
  | null

export type AuditActor = "admin" | "user" | "cron" | "anonymous"

export function resolveAuditActor(
  session: AuditIdentitySession,
  isCronRequest: boolean,
  explicitActor?: AuditActor
): AuditActor {
  if (explicitActor) return explicitActor
  if (isCronRequest) return "cron"
  if (session?.actor === "user") return "user"
  if (session?.actor === "admin") return "admin"
  return "anonymous"
}
