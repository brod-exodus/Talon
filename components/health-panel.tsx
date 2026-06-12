"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuthPermissions } from "@/lib/client-permissions"

type CheckStatus = "ok" | "warn" | "error"

type HealthCheck = {
  status: CheckStatus
  message: string
  detail?: string
}

type HealthResponse = {
  status: CheckStatus
  checkedAt: string
  checks?: Record<string, HealthCheck>
  error?: string
}

function statusBadge(status: CheckStatus) {
  if (status === "ok") {
    return <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-500">Healthy</Badge>
  }
  if (status === "warn") {
    return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Attention</Badge>
  }
  return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Blocked</Badge>
}

function statusIcon(status: CheckStatus) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-500" />
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />
  return <ShieldAlert className="h-4 w-4 text-destructive" />
}

function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())
}

type HealthPanelProps = {
  showHealthy?: boolean
}

export function HealthPanel({ showHealthy = false }: HealthPanelProps) {
  const { canAdmin } = useAuthPermissions()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const visibleChecks = useMemo(() => {
    if (!health?.checks) return []
    const checks = Object.entries(health.checks)
    if (showHealthy) return checks
    return checks.filter(([, check]) => check.status !== "ok")
  }, [health, showHealthy])

  const loadHealth = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/health", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setHealth({
          status: "warn",
          checkedAt: new Date().toISOString(),
          checks: {
            healthEndpoint: {
              status: "warn",
              message: "Operational diagnostics are restricted to admins.",
              detail: typeof data?.error === "string" ? data.error : "Forbidden",
            },
          },
        })
        return
      }
      setHealth(data)
    } catch (error) {
      console.error("[health] fetch error:", error)
      setHealth({
        status: "error",
        checkedAt: new Date().toISOString(),
        checks: {
          healthEndpoint: {
            status: "error",
            message: "Unable to fetch health diagnostics",
            detail: error instanceof Error ? error.message : "Unknown health error",
          },
        },
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!canAdmin) {
      setLoading(false)
      return
    }
    loadHealth()
    const interval = setInterval(loadHealth, 60000)
    return () => clearInterval(interval)
  }, [canAdmin, loadHealth])

  if (!canAdmin) return null
  if (loading) return null
  if (!showHealthy && health?.status === "ok") return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-sm font-semibold">Production Readiness</CardTitle>
              {showHealthy && (
                <CardDescription>
                  Admin-only deployment and infrastructure diagnostics.
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(health?.status ?? "error")}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={refreshing}
              onClick={loadHealth}
              aria-label="Refresh health checks"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleChecks.length === 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50/70 p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">All checks healthy</p>
              <p className="text-sm text-muted-foreground">No production readiness issues are currently visible.</p>
            </div>
          </div>
        )}
        {visibleChecks.map(([key, check]) => (
          <div key={key} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            {statusIcon(check.status)}
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{formatLabel(key)}</p>
              <p className="text-sm text-muted-foreground">{check.message}</p>
              {check.detail && <p className="break-words text-xs text-muted-foreground">{check.detail}</p>}
            </div>
          </div>
        ))}
        {health?.checkedAt && (
          <p className="text-xs text-muted-foreground">
            Last checked {new Date(health.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
