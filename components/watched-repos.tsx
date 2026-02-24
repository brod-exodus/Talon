"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Eye, Trash2, Plus, Clock, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

type WatchedRepo = {
  id: string
  repo: string
  interval_hours: number
  active: boolean
  last_checked_at: string | null
  created_at: string
}

const INTERVAL_OPTIONS = [
  { label: "Every 1 hour", value: 1 },
  { label: "Every 6 hours", value: 6 },
  { label: "Every 12 hours", value: 12 },
  { label: "Every 24 hours", value: 24 },
  { label: "Every 48 hours", value: 48 },
]

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never checked"
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function WatchedRepos() {
  const [repos, setRepos] = useState<WatchedRepo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [repo, setRepo] = useState("")
  const [intervalHours, setIntervalHours] = useState("24")
  const { toast } = useToast()

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/watched-repos")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setRepos(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("[watched-repos] fetch error:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!repo.trim()) return

      setIsAdding(true)
      try {
        const res = await fetch("/api/watched-repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo: repo.trim(), interval_hours: Number(intervalHours) }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to add")
        }
        const added: WatchedRepo = await res.json()
        setRepos((prev) => [added, ...prev])
        setRepo("")
        toast({ title: "Watching repo", description: `Now watching ${added.repo}` })
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to add repo",
          variant: "destructive",
        })
      } finally {
        setIsAdding(false)
      }
    },
    [repo, intervalHours, toast]
  )

  const handleDelete = useCallback(
    async (id: string, repoName: string) => {
      const confirmed = window.confirm(`Stop watching ${repoName}?`)
      if (!confirmed) return

      try {
        const res = await fetch(`/api/watched-repos/${id}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Failed to delete")
        setRepos((prev) => prev.filter((r) => r.id !== id))
        toast({ title: "Removed", description: `No longer watching ${repoName}` })
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Failed to remove repo",
          variant: "destructive",
        })
      }
    },
    [toast]
  )

  const handleManualCheck = useCallback(async () => {
    setIsChecking(true)
    try {
      const res = await fetch("/api/watched-repos/check", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Check failed")

      const totalNew = (data.results ?? []).reduce(
        (sum: number, r: { newContributors: number }) => sum + r.newContributors,
        0
      )
      toast({
        title: "Check complete",
        description: `Checked ${data.checked} repo(s). ${totalNew} new contributor(s) found.`,
      })
      await fetchRepos()
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Check failed",
        variant: "destructive",
      })
    } finally {
      setIsChecking(false)
    }
  }, [toast, fetchRepos])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-semibold tracking-tight">Watched Repos</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualCheck}
          disabled={isChecking || repos.length === 0}
          className="bg-transparent hover:bg-primary/10 transition-all duration-300 text-xs"
        >
          <RefreshCw className={`w-3 h-3 mr-2 ${isChecking ? "animate-spin" : ""}`} />
          {isChecking ? "Checking..." : "Check Now"}
        </Button>
      </div>

      {/* Add form */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <CardHeader className="relative pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Watch a Repository
          </CardTitle>
          <CardDescription className="text-xs">
            Get notified when new contributors appear
          </CardDescription>
        </CardHeader>
        <CardContent className="relative">
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="watch-repo" className="text-xs text-muted-foreground">
                Repository (owner/repo)
              </Label>
              <Input
                id="watch-repo"
                placeholder="e.g. vercel/next.js"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="bg-input/50 border-border/50 focus:border-primary/50 transition-colors h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="watch-interval" className="text-xs text-muted-foreground">
                Check interval
              </Label>
              <Select value={intervalHours} onValueChange={setIntervalHours}>
                <SelectTrigger
                  id="watch-interval"
                  className="bg-input/50 border-border/50 h-8 text-sm w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={!repo.trim() || isAdding}
                size="sm"
                className="h-8 text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isAdding ? "Adding..." : "Watch"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Repo list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i} className="border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : repos.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="pt-6 pb-6">
            <div className="text-center py-6">
              <Eye className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No repos being watched yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a repo above to track new contributors.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {repos.map((r, index) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, delay: index * 0.04 }}
              >
                <Card className="border-border bg-card hover:border-primary/40 transition-all duration-300 hover:shadow-md hover:shadow-primary/5">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium text-foreground truncate">
                          {r.repo}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <Badge
                            variant="secondary"
                            className="bg-primary/10 text-primary border-primary/20 text-xs"
                          >
                            Every {r.interval_hours}h
                          </Badge>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {formatTimeAgo(r.last_checked_at)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => handleDelete(r.id, r.repo)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
