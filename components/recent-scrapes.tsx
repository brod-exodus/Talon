"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
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
  Plus,
  X,
  FolderPlus,
  Edit2,
  Filter,
  Users,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge" // Added Badge component for visual indicators

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
  role?: string
  completedAt: Date
  contributors: Contributor[]
}

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

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
  const [customRoles, setCustomRoles] = useState<string[]>([])
  const [showAddRole, setShowAddRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [editingRole, setEditingRole] = useState<string | null>(null)
  const [editRoleName, setEditRoleName] = useState("")
  const [activeFilter, setActiveFilter] = useState<string>("all")
  const { toast } = useToast()

  const [showDuplicates, setShowDuplicates] = useState(false)

  const debouncedScrapes = useDebounce(scrapes, 500)

  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const response = await fetch("/api/scrapes")
        const data = await response.json()

        const persistedScrapesData = localStorage.getItem("completed-scrapes")
        const persistedScrapes: CompletedScrape[] = persistedScrapesData ? JSON.parse(persistedScrapesData) : []

        const persistedRoles = new Map(persistedScrapes.map((s) => [s.id, s.role]))

        const apiScrapes = (data.completed || []).map((scrape: CompletedScrape) => ({
          ...scrape,
          role: persistedRoles.get(scrape.id) || scrape.role,
        }))

        const apiScrapeIds = new Set(apiScrapes.map((s: CompletedScrape) => s.id))
        const uniquePersistedScrapes = persistedScrapes.filter((s) => !apiScrapeIds.has(s.id))
        const allScrapes = [...apiScrapes, ...uniquePersistedScrapes]

        if (allScrapes.length > 0) {
          localStorage.setItem("completed-scrapes", JSON.stringify(allScrapes))
        }

        const globalOutreachData = localStorage.getItem("global-outreach")
        const globalOutreach = globalOutreachData ? JSON.parse(globalOutreachData) : {}

        const scrapesWithOutreach = allScrapes.map((scrape: CompletedScrape) => {
          return {
            ...scrape,
            contributors: scrape.contributors.map((contributor) => ({
              ...contributor,
              ...globalOutreach[contributor.username],
            })),
          }
        })

        const sortedScrapes = scrapesWithOutreach.sort((a, b) => {
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        })

        setScrapes(sortedScrapes)
      } catch (error) {
        console.error("[v0] Failed to fetch scrapes:", error)
        const persistedScrapesData = localStorage.getItem("completed-scrapes")
        if (persistedScrapesData) {
          const persistedScrapes: CompletedScrape[] = JSON.parse(persistedScrapesData)
          const sortedPersistedScrapes = persistedScrapes.sort((a, b) => {
            return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
          })
          setScrapes(sortedPersistedScrapes)
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchScrapes()
    const interval = setInterval(fetchScrapes, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (debouncedScrapes.length > 0) {
      localStorage.setItem("completed-scrapes", JSON.stringify(debouncedScrapes))
    }
  }, [debouncedScrapes])

  useEffect(() => {
    const rolesData = localStorage.getItem("scrape-roles")
    if (rolesData) {
      setCustomRoles(JSON.parse(rolesData))
    }
  }, [])

  useEffect(() => {
    if (customRoles.length > 0) {
      localStorage.setItem("scrape-roles", JSON.stringify(customRoles))
    }
  }, [customRoles])

  const updateContributorOutreach = useCallback(
    (scrapeId: string, username: string, updates: { contacted?: boolean; contactedDate?: string; notes?: string }) => {
      const globalOutreachData = localStorage.getItem("global-outreach")
      const globalOutreach = globalOutreachData ? JSON.parse(globalOutreachData) : {}

      globalOutreach[username] = {
        ...globalOutreach[username],
        ...updates,
      }

      localStorage.setItem("global-outreach", JSON.stringify(globalOutreach))

      setScrapes((prev) =>
        prev.map((scrape) => ({
          ...scrape,
          contributors: scrape.contributors.map((contributor) => {
            if (contributor.username === username) {
              return { ...contributor, ...updates }
            }
            return contributor
          }),
        })),
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

  const addRole = useCallback(() => {
    if (!newRoleName.trim()) return
    if (customRoles.includes(newRoleName.trim())) {
      toast({
        title: "Role already exists",
        description: "This role name is already in use",
        variant: "destructive",
      })
      return
    }

    setCustomRoles((prev) => [...prev, newRoleName.trim()])
    setNewRoleName("")
    setShowAddRole(false)
    toast({
      title: "Role added",
      description: `"${newRoleName.trim()}" tab has been created`,
    })
  }, [newRoleName, customRoles, toast])

  const renameRole = useCallback(
    (oldName: string) => {
      if (!editRoleName.trim() || editRoleName.trim() === oldName) {
        setEditingRole(null)
        setEditRoleName("")
        return
      }

      if (customRoles.includes(editRoleName.trim())) {
        toast({
          title: "Role already exists",
          description: "This role name is already in use",
          variant: "destructive",
        })
        return
      }

      setCustomRoles((prev) => prev.map((r) => (r === oldName ? editRoleName.trim() : r)))

      setScrapes((prev) =>
        prev.map((scrape) => (scrape.role === oldName ? { ...scrape, role: editRoleName.trim() } : scrape)),
      )

      setEditingRole(null)
      setEditRoleName("")

      toast({
        title: "Role renamed",
        description: `"${oldName}" has been renamed to "${editRoleName.trim()}"`,
      })
    },
    [editRoleName, customRoles, toast],
  )

  const deleteRole = useCallback(
    (roleName: string) => {
      const scrapesWithRole = scrapes.filter((s) => s.role === roleName)
      const confirmMessage =
        scrapesWithRole.length > 0
          ? `Are you sure you want to delete "${roleName}"? ${scrapesWithRole.length} scrape(s) will be moved to "Untagged".`
          : `Are you sure you want to delete "${roleName}"?`

      if (!window.confirm(confirmMessage)) return

      setCustomRoles((prev) => prev.filter((r) => r !== roleName))

      setScrapes((prev) => prev.map((scrape) => (scrape.role === roleName ? { ...scrape, role: undefined } : scrape)))

      toast({
        title: "Role deleted",
        description: `"${roleName}" has been removed`,
      })
    },
    [scrapes, toast],
  )

  const assignScrapeToRole = useCallback(
    (scrapeId: string, roleName: string | undefined) => {
      setScrapes((prev) => {
        const updated = prev.map((scrape) => (scrape.id === scrapeId ? { ...scrape, role: roleName } : scrape))
        localStorage.setItem("completed-scrapes", JSON.stringify(updated))
        return updated
      })

      const scrape = scrapes.find((s) => s.id === scrapeId)
      if (scrape) {
        toast({
          title: "Scrape moved",
          description: roleName ? `Moved to "${roleName}"` : "Moved to Untagged",
        })
      }
    },
    [scrapes, toast],
  )

  const roles = useMemo(() => {
    return customRoles
  }, [customRoles])

  const scrapesByRole = useMemo(() => {
    const byRole: Record<string, CompletedScrape[]> = {}
    roles.forEach((role) => {
      byRole[role] = scrapes.filter((s) => s.role === role)
    })
    return byRole
  }, [scrapes, roles])

  const orgScrapes = useMemo(() => scrapes.filter((s) => s.type === "organization"), [scrapes])
  const repoScrapes = useMemo(() => scrapes.filter((s) => s.type === "repository"), [scrapes])
  const untaggedScrapes = useMemo(() => scrapes.filter((s) => !s.role), [scrapes])

  const filteredScrapes = useMemo(() => {
    if (activeFilter === "all") return scrapes
    if (activeFilter === "organizations") return orgScrapes
    if (activeFilter === "repositories") return repoScrapes
    if (activeFilter === "untagged") return untaggedScrapes
    return scrapesByRole[activeFilter] || []
  }, [activeFilter, scrapes, orgScrapes, repoScrapes, untaggedScrapes, scrapesByRole])

  const getFilterLabel = useCallback(() => {
    if (activeFilter === "all") return `All (${scrapes.length})`
    if (activeFilter === "organizations") return `Organizations (${orgScrapes.length})`
    if (activeFilter === "repositories") return `Repositories (${repoScrapes.length})`
    if (activeFilter === "untagged") return `Untagged (${untaggedScrapes.length})`
    const roleCount = scrapesByRole[activeFilter]?.length || 0
    return `${activeFilter} (${roleCount})`
  }, [activeFilter, scrapes.length, orgScrapes.length, repoScrapes.length, untaggedScrapes.length, scrapesByRole])

  const deleteScrape = useCallback(
    async (scrapeId: string) => {
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

        const persistedScrapesData = localStorage.getItem("completed-scrapes")
        if (persistedScrapesData) {
          const persistedScrapes: CompletedScrape[] = JSON.parse(persistedScrapesData)
          const updatedScrapes = persistedScrapes.filter((s) => s.id !== scrapeId)
          localStorage.setItem("completed-scrapes", JSON.stringify(updatedScrapes))
        }

        const globalOutreachData = localStorage.getItem("global-outreach")
        const globalOutreach = globalOutreachData ? JSON.parse(globalOutreachData) : {}
        const scrapeToDelete = scrapes.find((s) => s.id === scrapeId)
        if (scrapeToDelete) {
          scrapeToDelete.contributors.forEach((contributor) => {
            delete globalOutreach[contributor.username]
          })
          localStorage.setItem("global-outreach", JSON.stringify(globalOutreach))
        }

        setScrapes((prev) => prev.filter((scrape) => scrape.id !== scrapeId))
      } catch (error) {
        console.error("[v0] Failed to delete scrape:", error)
      }
    },
    [scrapes],
  )

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

  const duplicateContributors = useMemo(() => {
    const contributorMap = new Map<
      string,
      {
        contributor: Contributor
        scrapes: { id: string; target: string; type: string }[]
      }
    >()

    scrapes.forEach((scrape) => {
      scrape.contributors.forEach((contributor) => {
        const existing = contributorMap.get(contributor.username)
        if (existing) {
          existing.scrapes.push({
            id: scrape.id,
            target: scrape.target,
            type: scrape.type,
          })
        } else {
          contributorMap.set(contributor.username, {
            contributor,
            scrapes: [
              {
                id: scrape.id,
                target: scrape.target,
                type: scrape.type,
              },
            ],
          })
        }
      })
    })

    // Filter to only contributors who appear in 2+ scrapes
    const duplicates = Array.from(contributorMap.values())
      .filter((entry) => entry.scrapes.length > 1)
      .sort((a, b) => b.scrapes.length - a.scrapes.length)

    return duplicates
  }, [scrapes])

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
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <FolderPlus className="w-4 h-4 mr-1" />
                        {scrape.role || "Move to..."}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => assignScrapeToRole(scrape.id, undefined)}
                        className="cursor-pointer"
                      >
                        Untagged
                      </DropdownMenuItem>
                      {customRoles.map((role) => (
                        <DropdownMenuItem
                          key={role}
                          onClick={() => assignScrapeToRole(scrape.id, role)}
                          className="cursor-pointer"
                        >
                          {role}
                          {scrape.role === role && <Check className="w-4 h-4 ml-auto" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => deleteScrape(scrape.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
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
                      transition={{ duration: 0.15 }} // Reduced from 0.3s to 0.15s for faster expand/collapse
                      className="space-y-3 mt-4 max-h-[600px] overflow-y-auto pr-2"
                    >
                      {contributorsWithContacts.map((contributor, index) => {
                        const isDuplicate = duplicateContributors.some(
                          (dup) => dup.contributor.username === contributor.username,
                        )
                        const duplicateEntry = duplicateContributors.find(
                          (dup) => dup.contributor.username === contributor.username,
                        )

                        return (
                          <motion.div
                            key={contributor.username}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2, delay: index * 0.03 }} // Reduced delay from 0.05s to 0.03s for faster stagger
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
                                  {isDuplicate && (
                                    <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                                      {duplicateEntry?.scrapes.length}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold text-foreground">{contributor.name}</p>
                                    {isDuplicate && (
                                      <Badge variant="secondary" className="text-xs">
                                        <Users className="w-3 h-3 mr-1" />
                                        In {duplicateEntry?.scrapes.length} scrapes
                                      </Badge>
                                    )}
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
                                <motion.div
                                  whileHover={{ x: 4 }}
                                  className="flex items-center gap-2 text-sm cursor-pointer group"
                                  onClick={() => copyToClipboard(contributor.contacts.email!, "Email")}
                                >
                                  <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                  <span className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors">
                                    {contributor.contacts.email}
                                  </span>
                                </motion.div>
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
                                    transition={{ duration: 0.1 }} // Reduced from 0.2s to 0.1s for faster contacted fields animation
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
                        )
                      })}
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
      customRoles,
      assignScrapeToRole,
      duplicateContributors, // Added duplicateContributors to dependencies
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Completed Scrapes</h2>
      </div>

      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-[200px] justify-between bg-transparent">
              <span className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                {getFilterLabel()}
              </span>
              <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[240px]">
            <DropdownMenuItem onClick={() => setActiveFilter("all")} className="cursor-pointer">
              All ({scrapes.length}){activeFilter === "all" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setActiveFilter("organizations")} className="cursor-pointer">
              Organizations ({orgScrapes.length})
              {activeFilter === "organizations" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveFilter("repositories")} className="cursor-pointer">
              Repositories ({repoScrapes.length})
              {activeFilter === "repositories" && <Check className="w-4 h-4 ml-auto" />}
            </DropdownMenuItem>
            {untaggedScrapes.length > 0 && (
              <DropdownMenuItem onClick={() => setActiveFilter("untagged")} className="cursor-pointer">
                Untagged ({untaggedScrapes.length})
                {activeFilter === "untagged" && <Check className="w-4 h-4 ml-auto" />}
              </DropdownMenuItem>
            )}
            {roles.length > 0 && <DropdownMenuSeparator />}
            {roles.map((role) => (
              <DropdownMenuItem
                key={role}
                onClick={() => setActiveFilter(role)}
                className="cursor-pointer justify-between group"
              >
                <span className="flex items-center gap-2">
                  {role} ({scrapesByRole[role].length}){activeFilter === role && <Check className="w-4 h-4" />}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingRole(role)
                      setEditRoleName(role)
                    }}
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteRole(role)
                    }}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {showAddRole ? (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Role name..."
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRole()
                if (e.key === "Escape") {
                  setShowAddRole(false)
                  setNewRoleName("")
                }
              }}
              className="h-10 w-48"
              autoFocus
            />
            <Button size="sm" onClick={addRole} disabled={!newRoleName.trim()}>
              <Check className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowAddRole(false)
                setNewRoleName("")
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowAddRole(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add Role
          </Button>
        )}

        {editingRole && (
          <div className="flex items-center gap-2 ml-auto">
            <Input
              placeholder="New role name..."
              value={editRoleName}
              onChange={(e) => setEditRoleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameRole(editingRole)
                if (e.key === "Escape") {
                  setEditingRole(null)
                  setEditRoleName("")
                }
              }}
              className="h-10 w-48"
              autoFocus
            />
            <Button size="sm" onClick={() => renameRole(editingRole)}>
              <Check className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingRole(null)
                setEditRoleName("")
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {duplicateContributors.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Cross-Scrape Contributors</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowDuplicates(!showDuplicates)}>
                {showDuplicates ? (
                  <>
                    <ChevronUp className="w-4 h-4 mr-1" />
                    Hide
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 mr-1" />
                    Show {duplicateContributors.length}
                  </>
                )}
              </Button>
            </div>
            <CardDescription>
              Contributors who appear in multiple scrapes - high-value talent active across organizations
            </CardDescription>
          </CardHeader>
          <AnimatePresence>
            {showDuplicates && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
                  {duplicateContributors.map((entry, index) => (
                    <motion.div
                      key={entry.contributor.username}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-all duration-300"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <img
                              src={entry.contributor.avatar || "/placeholder.svg?height=40&width=40"}
                              alt={entry.contributor.name}
                              className="w-10 h-10 rounded-full ring-2 ring-primary"
                            />
                            <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                              {entry.scrapes.length}
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">{entry.contributor.name}</p>
                              {entry.contributor.contacted && (
                                <Badge variant="default" className="text-xs bg-green-500">
                                  <Check className="w-3 h-3 mr-1" />
                                  Contacted
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground font-mono">@{entry.contributor.username}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`https://github.com/${entry.contributor.username}`)}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          GitHub
                        </Button>
                      </div>

                      <div className="pl-14 space-y-1">
                        <p className="text-xs text-muted-foreground font-semibold mb-2">Appears in:</p>
                        {entry.scrapes.map((scrape) => (
                          <div key={scrape.id} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-xs">
                              {scrape.type}
                            </Badge>
                            <span className="font-mono text-muted-foreground">{scrape.target}</span>
                          </div>
                        ))}
                      </div>

                      {(entry.contributor.contacts.email ||
                        entry.contributor.contacts.twitter ||
                        entry.contributor.contacts.linkedin ||
                        entry.contributor.contacts.website) && (
                        <div className="pl-14 pt-2 border-t border-border space-y-2">
                          {entry.contributor.contacts.email && (
                            <div
                              className="flex items-center gap-2 text-sm cursor-pointer group"
                              onClick={() => copyToClipboard(entry.contributor.contacts.email!, "Email")}
                            >
                              <Mail className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                              <span className="text-primary hover:underline font-mono break-all">
                                {entry.contributor.contacts.email}
                              </span>
                            </div>
                          )}
                          {entry.contributor.contacts.twitter && (
                            <div className="flex items-center gap-2 text-sm">
                              <XIcon className="w-4 h-4 text-muted-foreground" />
                              <a
                                href={`https://twitter.com/${entry.contributor.contacts.twitter}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-mono break-all"
                              >
                                @{entry.contributor.contacts.twitter}
                              </a>
                            </div>
                          )}
                          {entry.contributor.contacts.linkedin && (
                            <div className="flex items-center gap-2 text-sm">
                              <Linkedin className="w-4 h-4 text-muted-foreground" />
                              <a
                                href={`https://linkedin.com/in/${entry.contributor.contacts.linkedin}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-mono break-all"
                              >
                                linkedin.com/in/{entry.contributor.contacts.linkedin}
                              </a>
                            </div>
                          )}
                          {entry.contributor.contacts.website && (
                            <div className="flex items-center gap-2 text-sm">
                              <Globe className="w-4 h-4 text-muted-foreground" />
                              <a
                                href={entry.contributor.contacts.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-mono break-all"
                              >
                                {entry.contributor.contacts.website}
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      <div className="mt-6">
        {filteredScrapes.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Inbox className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {activeFilter === "all" ? "No scrapes yet" : `No ${activeFilter} scrapes`}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Start by scraping a GitHub organization or repository
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">{filteredScrapes.map((scrape) => renderContributorList(scrape))}</div>
        )}
      </div>
    </div>
  )
}
