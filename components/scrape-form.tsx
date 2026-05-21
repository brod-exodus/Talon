"use client"

import type React from "react"

import { useState, useCallback, useMemo, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings, AlertCircle, Rocket } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getStoredGithubToken } from "@/lib/client-secrets"
import { useAuthPermissions } from "@/lib/client-permissions"

export function ScrapeForm() {
  const { canWrite } = useAuthPermissions()
  const [type, setType] = useState("organization")
  const [target, setTarget] = useState("")
  const [minContributions, setMinContributions] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [existingTargets, setExistingTargets] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    fetch("/api/scrapes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const completed = data.completed || []
        setExistingTargets(new Set(completed.map((s: { type: string; target: string }) => `${s.type}:${s.target}`)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isDuplicate = useMemo(() => {
    if (!target) return false
    return existingTargets.has(`${type}:${target}`)
  }, [target, type, existingTargets])

  const typeMismatch = useMemo<"looks-like-repo" | "looks-like-org" | null>(() => {
    if (!target.trim()) return null
    if (type === "organization" && target.includes("/")) return "looks-like-repo"
    if (type === "repository" && !target.includes("/")) return "looks-like-org"
    return null
  }, [target, type])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!canWrite) {
        toast({
          title: "Read-only access",
          description: "Your current role can view scrapes but cannot start new ones.",
          variant: "destructive",
        })
        return
      }

      const { token } = getStoredGithubToken()

      if (!token) {
        toast({
          title: "GitHub token required",
          description: "Please add your GitHub token in Settings first",
          variant: "destructive",
        })
        return
      }

      setIsLoading(true)

      try {
        const response = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, target: target.trim(), token, minContributions }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to start scrape")
        }

        const data = await response.json()

        const rateLimitMsg = data.rateLimit ? ` Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : ""
        toast({
          title: "Scrape queued",
          description: `Queued ${target} for processing.${rateLimitMsg}`,
        })

        setTarget("")
      } catch (error) {
        console.error("[v0] Scrape error:", error)
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to start scrape",
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    },
    [canWrite, type, target, minContributions, toast],
  )

  const getPlaceholder = () => {
    switch (type) {
      case "organization":
        return "e.g. vercel"
      case "repository":
        return "owner/repo"
      default:
        return ""
    }
  }

  const getLabel = () => {
    switch (type) {
      case "organization":
        return "Owner/Organization"
      case "repository":
        return "Repository"
      default:
        return "Target"
    }
  }

  return (
    <Card className="sticky top-24 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full prism-gradient text-white shadow-lg shadow-indigo-500/20">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-xl font-extrabold">Start New Scrape</CardTitle>
            <CardDescription>Discover contributors with contact information.</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!canWrite && (
          <Alert>
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription className="text-xs">
              Viewer access is read-only. Ask an admin to upgrade your role to start scrapes.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="type" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Source Type
          </Label>
          <Select value={type} onValueChange={setType} disabled={!canWrite}>
            <SelectTrigger id="type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Organization</SelectItem>
              <SelectItem value="repository">Repository</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            {getLabel()}
          </Label>
          <Input
            id="target"
            placeholder={getPlaceholder()}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!canWrite}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="minContributions" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Minimum Contributions
          </Label>
          <Input
            id="minContributions"
            type="number"
            min={1}
            value={minContributions}
            onChange={(e) => setMinContributions(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            disabled={!canWrite}
          />
          <p className="text-xs font-medium text-muted-foreground">
            Only include contributors with at least this many contributions
          </p>
        </div>

        {typeMismatch === "looks-like-repo" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like a repository (owner/repo). You must select <strong>Repository</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-7 px-3 text-xs"
                onClick={() => setType("repository")}
              >
                Switch to Repository
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {typeMismatch === "looks-like-org" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like an organization name. You must select <strong>Organization</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-7 px-3 text-xs"
                onClick={() => setType("organization")}
              >
                Switch to Organization
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isDuplicate && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <AlertDescription className="text-xs text-yellow-500">
              You have already scraped this {type}. Scraping again will create a duplicate.
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={!canWrite || !target || isLoading}
        >
          {isLoading ? "Starting..." : "Start Scrape"}
        </Button>

        <Link href="/settings" className="block">
          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs"
            size="sm"
          >
            <Settings className="w-3 h-3 mr-2" />
            Configure GitHub Token
          </Button>
        </Link>
      </form>
      </CardContent>
    </Card>
  )
}
