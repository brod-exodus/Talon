import { type NextRequest } from "next/server"
import { getAuthSession } from "@/lib/auth"
import {
  getTeamMembershipForSession,
  type TeamMembershipContext,
} from "@/lib/team-membership"

const membershipByRequest = new WeakMap<NextRequest, Promise<TeamMembershipContext | null>>()

/**
 * Resolve the signed-in user's current database membership once per request.
 *
 * Session cookies identify the user and workspace, but their embedded role is
 * only a login-time snapshot. Authorization must use this live membership so
 * removals and role changes take effect on the next request.
 */
export function getCurrentRequestMembership(
  request: NextRequest
): Promise<TeamMembershipContext | null> {
  const session = getAuthSession(request)
  if (session?.actor !== "user") return Promise.resolve(null)

  const cached = membershipByRequest.get(request)
  if (cached) return cached

  const membership = getTeamMembershipForSession(session.email, session.teamId)
  membershipByRequest.set(request, membership)
  return membership
}
