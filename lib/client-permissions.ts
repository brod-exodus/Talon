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
      }
    }
  | {
      authenticated: true
      actor: "user"
      email: string
      teamSlug: string
      role: AuthRole
      permissions: {
        canRead: boolean
        canWrite: boolean
        canAdmin: boolean
      }
    }

const DEFAULT_PERMISSIONS = {
  canRead: true,
  canWrite: false,
  canAdmin: false,
}

export function useAuthMe() {
  const [me, setMe] = useState<AuthMe | null>(null)

  useEffect(() => {
    let canceled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!canceled && data?.authenticated) setMe(data as AuthMe)
      })
      .catch(() => {
        if (!canceled) setMe(null)
      })
    return () => {
      canceled = true
    }
  }, [])

  return me
}

export function useAuthPermissions() {
  const me = useAuthMe()

  return useMemo(() => me?.permissions ?? DEFAULT_PERMISSIONS, [me])
}
