/**
 * Require an explicit workspace before using the service-role database client.
 * Service-role queries bypass RLS, so silently substituting another workspace
 * would turn a missing caller argument into a cross-workspace access risk.
 */
export function requireWorkspaceId(value: string | null | undefined): string {
  const workspaceId = value?.trim()
  if (!workspaceId) {
    throw new Error("Database operation requires explicit workspace context")
  }
  return workspaceId
}
