"use client"

import { TooltipContent } from "@/components/ui/tooltip"
import { TooltipTrigger } from "@/components/ui/tooltip"
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip"
import { useEffect, useState, useMemo, useCallback } from "react"
import { EmailCopyButton } from "@/components/email-copy-button" // Import EmailCopyButton

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export function RecentScrapes() {
  const [scrapes, setScrapes] = useState<CompletedScrape[]>([])
  const [expandedScrapes, setExpandedScrapes] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  const [debouncedScrapes, setDebouncedScrapes] = useState<CompletedScrape[]>([])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedScrapes(scrapes)
    }, 500)
    return () => clearTimeout(timer)
  }, [scrapes])

  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const response = await fetch("/api/scrapes")
        const data = await response.json()

        const persistedScrapesData = typeof window !== "undefined" ? localStorage.getItem("completed-scrapes") : null
        const persistedScrapes: CompletedScrape[] = persistedScrapesData ? JSON.parse(persistedScrapesData) : []

        const apiScrapeIds = new Set((data.completed || []).map((s: CompletedScrape) => s.id))
        const uniquePersistedScrapes = persistedScrapes.filter((s) => !apiScrapeIds.has(s.id))
        const allScrapes = [...(data.completed || []), ...uniquePersistedScrapes]

        if (allScrapes.length > 0 && typeof window !== "undefined") {
          localStorage.setItem("completed-scrapes", JSON.stringify(allScrapes))
        }

        const scrapesWithOutreach = allScrapes.map((scrape: CompletedScrape) => {
          const outreachData = typeof window !== "undefined" ? localStorage.getItem(`outreach-${scrape.id}`) : null
          if (outreachData) {
            const outreach = JSON.parse(outreachData)
            return {
              ...scrape,
              contributors: scrape.contributors.map((contributor) => ({
                ...contributor,
                ...outreach[contributor.username],
              })),
            }
          }
          return scrape
        })

        setScrapes(scrapesWithOutreach)
      } catch (error) {
        console.error("[v0] Failed to fetch scrapes:", error)
        if (typeof window !== "undefined") {
          const persistedScrapesData = localStorage.getItem("completed-scrapes")
          if (persistedScrapesData) {
            const persistedScrapes: CompletedScrape[] = JSON.parse(persistedScrapesData)
            setScrapes(persistedScrapes)
          }
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchScrapes()
    const interval = setInterval(fetchScrapes, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (debouncedScrapes.length > 0 && typeof window !== "undefined") {
      localStorage.setItem("completed-scrapes", JSON.stringify(debouncedScrapes))
    }
  }, [debouncedScrapes])

  const updateContributorOutreach = useCallback(
    (scrapeId: string, username: string, updates: { contacted?: boolean; contactedDate?: string; notes?: string }) => {
      if (typeof window === "undefined") return

      const outreachKey = `outreach-${scrapeId}`
      const existing = localStorage.getItem(outreachKey)
      const outreachData = existing ? JSON.parse(existing) : {}

      outreachData[username] = {
        ...outreachData[username],
        ...updates,
      }

      localStorage.setItem(outreachKey, JSON.stringify(outreachData))

      setScrapes((prev) =>
        prev.map((scrape) => {
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
        }),
      )
    },
    [],
  )

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

  const toggleExpanded = useCallback((scrapeId: string) => {
    setExpandedScrapes((prev) => {
      const next = new Set(prev)
      if (next.has(scrapeId)) {
        next.delete(scrapeId)
      } else {
        next.add(scrapeId)
      }
      return next
    })
  }, [])

  const getSortedContributors = useCallback((scrape: CompletedScrape) => {
    return [...scrape.contributors].sort((a, b) => b.contributions - a.contributions)
  }, [])

  const orgScrapes = useMemo(() => scrapes.filter((s) => s.type === "organization"), [scrapes])
  const repoScrapes = useMemo(() => scrapes.filter((s) => s.type === "repository"), [scrapes])

  const deleteScrape = useCallback(async (scrapeId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to permanently delete this scrape? This action cannot be undone.",
    )

    if (!confirmed) {
      return
    }

    try {
      await fetch(`/api/scrape/${scrapeId}`, {
        method: "DELETE",
      })

      if (typeof window !== "undefined") {
        const persistedScrapesData = localStorage.getItem("completed-scrapes")
        if (persistedScrapesData) {
          const persistedScrapes: CompletedScrape[] = JSON.parse(persistedScrapesData)
          const updatedScrapes = persistedScrapes.filter((s) => s.id !== scrapeId)
          localStorage.setItem("completed-scrapes", JSON.stringify(updatedScrapes))
        }

        localStorage.removeItem(`outreach-${scrapeId}`)
      }
      setScrapes((prev) => prev.filter((scrape) => scrape.id !== scrapeId))
    } catch (error) {
      console.error("[v0] Failed to delete scrape:", error)
    }
  }, [])

  const copyToClipboard = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text)
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
        duration: 2000,
      })
    },
    [toast],
  )

  const exportToCSV = useCallback(
    (scrape: CompletedScrape) => {
      const sortedContributors = getSortedContributors(scrape)
      const contributorsWithContacts = sortedContributors.filter(
        (c) => c.contacts.email || c.contacts.twitter || c.contacts.linkedin || c.contacts.website,
      )

      const headers = [
        "Name",
        "Username",
        "GitHub Profile",
        "Contributions",
        "Email",
        "Twitter",
        "LinkedIn",
        "Website",
        "Contacted",
        "Contact Date",
        "Notes",
      ]

      const rows = contributorsWithContacts.map((contributor) => [
        contributor.name,
        contributor.username,
        `https://github.com/${contributor.username}`,
        contributor.contributions,
        contributor.contacts.email || "",
        contributor.contacts.twitter ? `https://twitter.com/${contributor.contacts.twitter}` : "",
        contributor.contacts.linkedin ? `https://linkedin.com/in/${contributor.contacts.linkedin}` : "",
        contributor.contacts.website || "",
        contributor.contacted ? "Yes" : "No",
        contributor.contactedDate || "",
        contributor.notes || "",
      ])

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row
            .map((cell) => {
              const cellStr = String(cell)
              if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
                return `"${cellStr.replace(/"/g, '""')}"`
              }
              return cellStr
            })
            .join(","),
        ),
      ].join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)
      link.setAttribute("href", url)
      link.setAttribute("download", `${scrape.target.replace(/\//g, "-")}-contributors.csv`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: "Exported!",
        description: `Downloaded ${contributorsWithContacts.length} contributors to CSV`,
        duration: 3000,
      })
    },
    [getSortedContributors, toast],
  )

  const exportToExcel = useCallback(
    (scrape: CompletedScrape) => {
      const sortedContributors = getSortedContributors(scrape)
      const contributorsWithContacts = sortedContributors.filter(
        (c) => c.contacts.email || c.contacts.twitter || c.contacts.linkedin || c.contacts.website,
      )

      const headers = [
        "Name",
        "Username",
        "GitHub Profile",
        "Contributions",
        "Email",
        "Twitter",
        "LinkedIn",
        "Website",
        "Contacted",
        "Contact Date",
        "Notes",
      ]

      const rows = contributorsWithContacts.map((contributor) => [
        contributor.name,
        contributor.username,
        `https://github.com/${contributor.username}`,
        contributor.contributions,
        contributor.contacts.email || "",
        contributor.contacts.twitter ? `https://twitter.com/${contributor.contacts.twitter}` : "",
        contributor.contacts.linkedin ? `https://linkedin.com/in/${contributor.contacts.linkedin}` : "",
        contributor.contacts.website || "",
        contributor.contacted ? "Yes" : "No",
        contributor.contactedDate || "",
        contributor.notes || "",
      ])

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row
            .map((cell) => {
              const cellStr = String(cell)
              if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
                return `"${cellStr.replace(/"/g, '""')}"`
              }
              return cellStr
            })
            .join(","),
        ),
      ].join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)
      link.setAttribute("href", url)
      link.setAttribute("download", `${scrape.target.replace(/\//g, "-")}-contributors.xlsx`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast({
        title: "Exported!",
        description: `Downloaded ${contributorsWithContacts.length} contributors to Excel`,
        duration: 3000,
      })
    },
    [getSortedContributors, toast],
  )

  const renderContributorList = useCallback(
    (scrape: CompletedScrape) => {
      const isExpanded = expandedScrapes.has(scrape.id)
      const sortedContributors = getSortedContributors(scrape)
      const contributorsWithContacts = sortedContributors.filter(
        (c) => c.contacts.email || c.contacts.twitter || c.contacts.linkedin || c.contacts.website,
      )

      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          whileHover={{ y: -2 }}
        >
          <Card
            key={scrape.id}
            className="border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Calendar className="w-3 h-3" />
                    <span>{formatDate(scrape.completedAt)}</span>
                  </div>
                  <CardDescription className="text-xs">{formatTimeAgo(scrape.completedAt)}</CardDescription>
                  <CardTitle className="text-base font-mono mt-2">{scrape.target}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => deleteScrape(scrape.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Contributors</span>
                    <motion.span
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, type: "spring" }}
                      className="font-mono text-foreground"
                    >
                      {scrape.contributors.length}
                    </motion.span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">With Contact Info</span>
                    <motion.span
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, type: "spring", delay: 0.1 }}
                      className="font-mono text-green-500"
                    >
                      {contributorsWithContacts.length}
                    </motion.span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="bg-transparent hover:bg-primary/10 transition-all duration-300 flex-1"
                    onClick={() => toggleExpanded(scrape.id)}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Hide
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        View All ({contributorsWithContacts.length})
                      </>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => exportToCSV(scrape)} className="cursor-pointer">
                        <Download className="w-4 h-4 mr-2" />
                        CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportToExcel(scrape)} className="cursor-pointer">
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
                        Excel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3 mt-4 max-h-[600px] overflow-y-auto pr-2"
                    >
                      {contributorsWithContacts.map((contributor, index) => (
                        <motion.div
                          key={contributor.username}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.05 }}
                          className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-secondary/50 hover:bg-secondary hover:border-primary/30 transition-all duration-300 hover:shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="relative">
                                <img
                                  src={contributor.avatar || "/placeholder.svg?height=40&width=40"}
                                  alt={contributor.name}
                                  className="w-10 h-10 rounded-full ring-2 ring-border hover:ring-primary transition-all duration-300"
                                />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-foreground">{contributor.name}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-muted-foreground font-mono">
                                    @{contributor.username} · {contributor.contributions} contributions
                                  </p>
                                </div>
                              </div>
                            </div>

                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                              onClick={() => window.open(`https://github.com/${contributor.username}`)}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              GitHub
                            </Button>
                          </div>

                          <div className="space-y-2 pl-14">
                            {contributor.contacts.email && (
                              <EmailCopyButton email={contributor.contacts.email} />
                            )}
                            {contributor.contacts.twitter && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <XIcon className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={`https://twitter.com/${contributor.contacts.twitter}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  @{contributor.contacts.twitter}
                                </a>
                              </motion.div>
                            )}
                            {contributor.contacts.linkedin && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <Linkedin className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={`https://linkedin.com/in/${contributor.contacts.linkedin}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  linkedin.com/in/{contributor.contacts.linkedin}
                                </a>
                              </motion.div>
                            )}
                            {contributor.contacts.website && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={contributor.contacts.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  {contributor.contacts.website}
                                </a>
                              </motion.div>
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
                              <span className="text-sm text-muted-foreground transition-opacity duration-300 flex items-center gap-2">
                                {contributor.contacted && <Check className="w-4 h-4 text-green-500" />}
                                {contributor.contacted ? "Contacted" : "Toggle if contacted"}
                              </span>
                            </div>

                            <AnimatePresence>
                              {contributor.contacted && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="space-y-2"
                                >
                                  <div>
                                    <Label
                                      htmlFor={`date-${contributor.username}`}
                                      className="text-xs text-muted-foreground"
                                    >
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
                                      className="mt-1 h-8 text-sm bg-background transition-all duration-300 focus:ring-2 focus:ring-primary"
                                    />
                                  </div>
                                  <div>
                                    <Label
                                      htmlFor={`notes-${contributor.username}`}
                                      className="text-xs text-muted-foreground"
                                    >
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
                                      className="mt-1 h-8 text-sm bg-background transition-all duration-300 focus:ring-2 focus:ring-primary"
                                    />
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )
    },
    [
      expandedScrapes,
      getSortedContributors,
      toggleExpanded,
      deleteScrape,
      exportToCSV,
      exportToExcel,
      updateContributorOutreach,
      copyToClipboard,
    ],
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border bg-card">
              <CardHeader>
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Completed Scrapes</h2>

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
                    <Inbox className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No organization scrapes yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Start by scraping a GitHub organization to discover contributors
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try: <span className="font-mono text-primary">vercel</span>,{" "}
                      <span className="font-mono text-primary">facebook</span>, or{" "}
                      <span className="font-mono text-primary">microsoft</span>
                    </p>
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
                    <Inbox className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No repository scrapes yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Start by scraping a GitHub repository to discover contributors
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try: <span className="font-mono text-primary">vercel/next.js</span> or{" "}
                      <span className="font-mono text-primary">facebook/react</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4">{repoScrapes.map((scrape) => renderContributorList(scrape))}</div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}

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

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Mail,
  Linkedin,
  Globe,
  ExternalLink,
  Calendar,
  ChevronDown,
  ChevronUp,
  Trash2,
  Check,
  Download,
  FileSpreadsheet,
  Inbox,
  Copy,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
