"use client"

import type React from "react"

import { useState, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Rocket, Settings, AlertCircle } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function ScrapeForm() {
  const [type, setType] = useState("organization")
  const [target, setTarget] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const existingTargets = useMemo(() => {
    const persistedScrapesData = localStorage.getItem("completed-scrapes")
    if (persistedScrapesData) {
      const scrapes = JSON.parse(persistedScrapesData)
      return new Set(scrapes.map((s: any) => `${s.type}:${s.target}`))
    }
    return new Set()
  }, [])

  const isDuplicate = useMemo(() => {
    if (!target) return false
    return existingTargets.has(`${type}:${target}`)
  }, [target, type, existingTargets])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const token = localStorage.getItem("github_token")

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
          body: JSON.stringify({ type, target, token }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to start scrape")
        }

        const data = await response.json()

        fetch(`/api/scrape/${data.scrapeId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, target, token }),
        })

        const rateLimitMsg = data.rateLimit ? ` Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : ""
        toast({
          title: "Scrape started",
          description: `Processing ${target}...${rateLimitMsg}`,
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
    [type, target, toast],
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
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm sticky top-24 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
      <CardHeader className="relative">
        <CardTitle className="text-lg">New Scrape</CardTitle>
        <CardDescription className="text-xs">Discover contributors with contact information</CardDescription>
      </CardHeader>
      <CardContent className="relative">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type" className="text-sm font-medium">
              Source Type
            </Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="type" className="bg-input/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="repository">Repository</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target" className="text-sm font-medium">
              {getLabel()}
            </Label>
            <Input
              id="target"
              placeholder={getPlaceholder()}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="bg-input/50 border-border/50 focus:border-primary/50 transition-colors"
            />
          </div>

          {isDuplicate && (
            <Alert className="border-yellow-500/50 bg-yellow-500/10">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertDescription className="text-xs text-yellow-500">
                You've already scraped this {type}. Scraping again will create a duplicate.
              </AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium relative overflow-hidden group"
            disabled={!target || isLoading}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
            <Rocket className="w-4 h-4 mr-2" />
            {isLoading ? "Starting..." : "Start Scrape"}
          </Button>

          <Link href="/settings" className="block">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
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
