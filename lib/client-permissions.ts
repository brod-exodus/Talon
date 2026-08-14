"use client"

import { useEffect, useMemo, useState } from "react"
import { type AuthRole } from "@/lib/auth-token"

export type AuthMe =
  | {
      authenticated: true
      actor: "admin"
      permissions: {
        canRead: true
        canWrite: true
        canAdmin: true
        canManageMembers: true
      }
    }
  | {
      authenticated: true
      actor: "user"
      email: string
      displayName: string | null
      avatarUrl: string | null
      teamSlug: string
      role: AuthRole
      permissions: {
        canRead: boolean
        canWrite: boolean
        canAdmin: boolean
        canManageMembers: boolean
      }
    }

export const AUTH_ME_REFRESH_EVENT = "talon-auth-me-refresh"

const DEFAULT_PERMISSIONS = {
  canRead: true,
  canWrite: false,
  canAdmin: false,
  canManageMembers: false,
}

export function useAuthMe() {
  const [me, setMe] = useState<AuthMe | null>(null)

  useEffect(() => {
    let canceled = false

    function loadAuthMe() {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!canceled && data?.authenticated) setMe(data as AuthMe)
        })
        .catch(() => {
          if (!canceled) setMe(null)
        })
    }

    loadAuthMe()
    window.addEventListener(AUTH_ME_REFRESH_EVENT, loadAuthMe)
    return () => {
      canceled = true
      window.removeEventListener(AUTH_ME_REFRESH_EVENT, loadAuthMe)
    }
  }, [])

  return me
}

export function useAuthPermissions() {
  const me = useAuthMe()

  return useMemo(() => me?.permissions ?? DEFAULT_PERMISSIONS, [me])
}
