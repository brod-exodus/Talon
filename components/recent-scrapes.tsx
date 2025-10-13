"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Database, Mail, Linkedin, Globe, ExternalLink, Calendar, ChevronDown, ChevronUp } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Contributor = {
  username: string
  name: string
  avatar: string
  contributions: number
  contacts: {
    email?: string
    twitter?: string
    linkedin?: string
    website?: string
  }
  contacted?: boolean
  contactedDate?: string
  notes?: string
}

type CompletedScrape = {
  id: string
  target: string
  type: string
  completedAt: Date
  contributors: Contributor[]
}

const STORAGE_KEY = "groq-talent-scrapes"

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export function RecentScrapes() {
  const [scrapes, setScrapes] = useState<CompletedScrape[]>([])
  const [expandedScrapes, setExpandedScrapes] = useState<Set<string>>(new Set())

  const saveScrapes = (updatedScrapes: CompletedScrape[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScrapes))
      setScrapes(updatedScrapes)
    } catch (error) {
      console.error("[v0] Failed to save scrapes to storage:", error)
    }
  }

  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const parsed = JSON.parse(stored)
          const scrapes = parsed.map((s: any) => ({
            ...s,
            completedAt: new Date(s.completedAt),
          }))
          setScrapes(scrapes)
        }
      } catch (error) {
        console.error("[v0] Failed to load scrapes from storage:", error)
      }
    }

    loadFromStorage()
  }, [])

  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const response = await fetch("/api/scrapes")
        const data = await response.json()
        const serverScrapes = data.completed || []

        if (serverScrapes.length > 0) {
          setScrapes((prev) => {
            const existingIds = new Set(prev.map((s) => s.id))
            const newScrapes = serverScrapes.filter((s: CompletedScrape) => !existingIds.has(s.id))
            const merged = [...prev, ...newScrapes]

            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
            } catch (error) {
              console.error("[v0] Failed to save scrapes to storage:", error)
            }

            return merged
          })
        }
      } catch (error) {
        console.error("[v0] Failed to fetch scrapes:", error)
      }
    }

    fetchScrapes()
    const interval = setInterval(fetchScrapes, 5000)
    return () => clearInterval(interval)
  }, [])

  const updateContributorOutreach = (
    scrapeId: string,
    username: string,
    updates: { contacted?: boolean; contactedDate?: string; notes?: string },
  ) => {
    const updatedScrapes = scrapes.map((scrape) => {
      if (scrape.id === scrapeId) {
        return {
          ...scrape,
          contributors: scrape.contributors.map((contributor) => {
            if (contributor.username === username) {
              return { ...contributor, ...updates }
            }
            return contributor
          }),
        }
      }
      return scrape
    })
    saveScrapes(updatedScrapes)
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(date))
  }

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
    const days = Math.floor(hours / 24)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }

  const toggleExpanded = (scrapeId: string) => {
    setExpandedScrapes((prev) => {
      const next = new Set(prev)
      if (next.has(scrapeId)) {
        next.delete(scrapeId)
      } else {
        next.add(scrapeId)
      }
      return next
    })
  }

  const getSortedContributors = (scrape: CompletedScrape) => {
    return [...scrape.contributors].sort((a, b) => b.contributions - a.contributions)
  }

  const orgScrapes = scrapes.filter((s) => s.type === "organization")
  const repoScrapes = scrapes.filter((s) => s.type === "repository")

  const renderContributorList = (scrape: CompletedScrape) => {
    const isExpanded = expandedScrapes.has(scrape.id)
    const sortedContributors = getSortedContributors(scrape)
    const contributorsWithContacts = sortedContributors.filter(
      (c) => c.contacts.email || c.contacts.twitter || c.contacts.linkedin || c.contacts.website,
    )

    return (
      <Card key={scrape.id} className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Calendar className="w-3 h-3" />
            <span>{formatDate(scrape.completedAt)}</span>
          </div>
          <CardDescription className="text-xs">{formatTimeAgo(scrape.completedAt)}</CardDescription>
          <CardTitle className="text-base font-mono">{scrape.target}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Contributors</span>
                <span className="font-mono text-foreground">{scrape.contributors.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">With Contact Info</span>
                <span className="font-mono text-chart-2">{contributorsWithContacts.length}</span>
              </div>
            </div>

            <Button variant="outline" className="w-full bg-transparent" onClick={() => toggleExpanded(scrape.id)}>
              {isExpanded ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-2" />
                  Hide Contributors
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-2" />
                  View All {contributorsWithContacts.length} Contributors
                </>
              )}
            </Button>

            {isExpanded && (
              <div className="space-y-3 mt-4 max-h-[600px] overflow-y-auto pr-2">
                {contributorsWithContacts.map((contributor) => (
                  <div
                    key={contributor.username}
                    className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <img
                          src={contributor.avatar || "/placeholder.svg?height=40&width=40"}
                          alt={contributor.name}
                          className="w-10 h-10 rounded-full"
                        />
                        <div>
                          <p className="font-semibold text-foreground">{contributor.name}</p>
                          <p className="text-sm text-muted-foreground font-mono">
                            @{contributor.username} · {contributor.contributions} contributions
                          </p>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-transparent"
                        onClick={() => window.open(`https://github.com/${contributor.username}`)}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        GitHub
                      </Button>
                    </div>

                    <div className="space-y-2 pl-14">
                      {contributor.contacts.email && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <a
                            href={`mailto:${contributor.contacts.email}`}
                            className="text-primary hover:underline font-mono break-all"
                          >
                            {contributor.contacts.email}
                          </a>
                        </div>
                      )}
                      {contributor.contacts.twitter && (
                        <div className="flex items-center gap-2 text-sm">
                          <XIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <a
                            href={`https://twitter.com/${contributor.contacts.twitter}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-mono break-all"
                          >
                            @{contributor.contacts.twitter}
                          </a>
                        </div>
                      )}
                      {contributor.contacts.linkedin && (
                        <div className="flex items-center gap-2 text-sm">
                          <Linkedin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <a
                            href={`https://linkedin.com/in/${contributor.contacts.linkedin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-mono break-all"
                          >
                            linkedin.com/in/{contributor.contacts.linkedin}
                          </a>
                        </div>
                      )}
                      {contributor.contacts.website && (
                        <div className="flex items-center gap-2 text-sm">
                          <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <a
                            href={contributor.contacts.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-mono break-all"
                          >
                            {contributor.contacts.website}
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="pl-14 pt-3 border-t border-border space-y-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`contacted-${contributor.username}`}
                          checked={contributor.contacted || false}
                          onCheckedChange={(checked) => {
                            updateContributorOutreach(scrape.id, contributor.username, {
                              contacted: checked,
                              contactedDate: checked ? new Date().toISOString().split("T")[0] : undefined,
                            })
                          }}
                        />
                        <span className="text-sm text-muted-foreground transition-opacity duration-300">
                          {contributor.contacted ? "Contacted" : "Toggle if contacted"}
                        </span>
                      </div>

                      {contributor.contacted && (
                        <div className="space-y-2">
                          <div>
                            <Label htmlFor={`date-${contributor.username}`} className="text-xs text-muted-foreground">
                              Contact Date
                            </Label>
                            <Input
                              id={`date-${contributor.username}`}
                              type="date"
                              value={contributor.contactedDate || ""}
                              onChange={(e) => {
                                updateContributorOutreach(scrape.id, contributor.username, {
                                  contactedDate: e.target.value,
                                })
                              }}
                              className="mt-1 h-8 text-sm bg-background"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`notes-${contributor.username}`} className="text-xs text-muted-foreground">
                              Notes (optional)
                            </Label>
                            <Input
                              id={`notes-${contributor.username}`}
                              type="text"
                              placeholder="e.g., Sent email, LinkedIn message..."
                              value={contributor.notes || ""}
                              onChange={(e) => {
                                updateContributorOutreach(scrape.id, contributor.username, {
                                  notes: e.target.value,
                                })
                              }}
                              className="mt-1 h-8 text-sm bg-background"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Your Talent Intelligence</h2>
      </div>

      <Tabs defaultValue="organizations" className="w-full">
        <TabsList className="bg-muted">
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="repositories">Repositories</TabsTrigger>
        </TabsList>

        <TabsContent value="organizations" className="space-y-4 mt-6">
          {orgScrapes.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No organization scrapes yet. Use the sidebar to add some!</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">{orgScrapes.map((scrape) => renderContributorList(scrape))}</div>
          )}
        </TabsContent>

        <TabsContent value="repositories" className="space-y-4 mt-6">
          {repoScrapes.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No repository scrapes yet. Use the sidebar to add some!</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">{repoScrapes.map((scrape) => renderContributorList(scrape))}</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
