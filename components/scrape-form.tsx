"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Rocket, Info, Settings } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"

export function ScrapeForm() {
  const [type, setType] = useState("organization")
  const [target, setTarget] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
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

      toast({
        title: "Scrape started",
        description: `Processing ${target}... Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}`,
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
  }

  return (
    <Card className="border-border bg-card sticky top-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          Add New Scrape
        </CardTitle>
        <CardDescription>Extract contributor intelligence from GitHub</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="repository">Repository</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target">{type === "organization" ? "Owner/Organization" : "Repository"}</Label>
            <Input
              id="target"
              placeholder={type === "organization" ? "metaplex-foundation" : "owner/repo"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="bg-input border-border"
            />
          </div>

          {type === "organization" && (
            <Alert className="bg-primary/10 border-primary/20">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm text-foreground">
                Organization scrapes will get contributors from all repositories
              </AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!target || isLoading}
          >
            {isLoading ? "Starting Scrape..." : "Start Scrape"}
          </Button>

          <Link href="/settings">
            <Button type="button" variant="outline" className="w-full bg-transparent" size="sm">
              <Settings className="w-4 h-4 mr-2" />
              Configure GitHub Token
            </Button>
          </Link>
        </form>
      </CardContent>
    </Card>
  )
}
