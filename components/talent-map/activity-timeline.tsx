"use client"

import { useState } from "react"
import { Flame, Mail, Linkedin, Globe, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ContributorActivity {
  username: string
  avatar: string
  lastWeekCommits: number
  last4Weeks: number[]
  totalCommits: number
  isTrending: boolean
  contacts: {
    email?: string
    twitter?: string
    linkedin?: string
    website?: string
  }
}

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export function ActivityTimeline() {
  const [expandedContributor, setExpandedContributor] = useState<string | null>(null)
  const [flippedContributor, setFlippedContributor] = useState<string | null>(null)

  const weeklyData = [
    { week: "4w ago", commits: 234 },
    { week: "3w ago", commits: 267 },
    { week: "2w ago", commits: 289 },
    { week: "Last week", commits: 345 },
  ]

  const contributors: ContributorActivity[] = [
    {
      username: "alex-chen-dev",
      avatar: "/developer-profile-photo-asian-male.jpg",
      lastWeekCommits: 7,
      last4Weeks: [4, 5, 6, 7],
      totalCommits: 464,
      isTrending: true,
      contacts: {
        email: "alex.chen@example.com",
        twitter: "alexchendev",
        linkedin: "alexchen",
        website: "https://alexchen.dev",
      },
    },
    {
      username: "casey-builds",
      avatar: "/developer-profile-photo-person.jpg",
      lastWeekCommits: 8,
      last4Weeks: [5, 6, 7, 8],
      totalCommits: 463,
      isTrending: true,
      contacts: {
        email: "casey@builds.io",
        linkedin: "caseybuilds",
      },
    },
    {
      username: "samrivera",
      avatar: "/developer-profile-photo-latino-male.jpg",
      lastWeekCommits: 6,
      last4Weeks: [4, 5, 5, 6],
      totalCommits: 495,
      isTrending: true,
      contacts: {
        email: "sam.rivera@tech.com",
        twitter: "samrivera",
        website: "https://samrivera.com",
      },
    },
    {
      username: "sarahk-code",
      avatar: "/developer-profile-photo-asian-female.jpg",
      lastWeekCommits: 6,
      last4Weeks: [3, 4, 5, 6],
      totalCommits: 376,
      isTrending: true,
      contacts: {
        email: "sarah.kim@example.com",
        linkedin: "sarahkim",
      },
    },
    {
      username: "jordan-lee",
      avatar: "/developer-profile-photo-person-glasses.jpg",
      lastWeekCommits: 7,
      last4Weeks: [4, 5, 6, 7],
      totalCommits: 390,
      isTrending: true,
      contacts: {
        email: "jordan@leetech.io",
        twitter: "jordanlee",
        linkedin: "jordanlee",
        website: "https://jordanlee.dev",
      },
    },
    {
      username: "tpark-dev",
      avatar: "/developer-profile-photo-person-smiling.jpg",
      lastWeekCommits: 5,
      last4Weeks: [3, 4, 4, 5],
      totalCommits: 384,
      isTrending: true,
      contacts: {
        twitter: "tparkdev",
        linkedin: "taylorpark",
      },
    },
  ]

  const maxCommits = Math.max(...weeklyData.map((d) => d.commits))
  const trendingContributors = contributors.filter((c) => c.isTrending)

  return (
    <div className="space-y-8">
      {/* Weekly Activity Chart */}
      <div>
        <h3 className="text-sm font-medium mb-4">Weekly Activity Trend</h3>
        <div className="h-[200px] flex items-end gap-4 px-4">
          {weeklyData.map((item, i) => {
            const heightPercent = (item.commits / maxCommits) * 100
            const isLastWeek = i === weeklyData.length - 1
            return (
              <div key={item.week} className="flex-1 flex flex-col items-center gap-3">
                <div className="w-full relative group cursor-pointer">
                  <div
                    className={`w-full rounded-t-lg transition-all ${
                      isLastWeek
                        ? "bg-gradient-to-t from-orange-500 to-orange-400"
                        : "bg-gradient-to-t from-primary/70 to-primary/50"
                    }`}
                    style={{ height: `${heightPercent * 1.5}px` }}
                  >
                    {/* Tooltip */}
                    <div className="absolute -top-14 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                        <div className="text-sm font-semibold">{item.commits} commits</div>
                        <div className="text-xs text-muted-foreground">{item.week}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-center font-medium">{item.week}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-medium">Trending Contributors</h3>
          <Badge variant="secondary" className="text-xs">
            5+ commits last week
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {trendingContributors.map((contributor) => {
            const isFlipped = flippedContributor === contributor.username

            return (
              <div
                key={contributor.username}
                className="h-[180px] cursor-pointer"
                style={{ perspective: "1000px" }}
                onClick={() => setFlippedContributor(isFlipped ? null : contributor.username)}
              >
                <div
                  className="relative w-full h-full transition-transform duration-500"
                  style={{
                    transformStyle: "preserve-3d",
                    transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}
                >
                  {/* Front of card */}
                  <div
                    className="absolute inset-0 p-3 rounded-lg bg-card border border-orange-500/20 hover:border-orange-500/40 transition-colors"
                    style={{ backfaceVisibility: "hidden" }}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <img
                        src={contributor.avatar || "/placeholder.svg"}
                        alt={contributor.username}
                        className="w-10 h-10 rounded-full ring-2 ring-orange-500/20"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium font-mono truncate">@{contributor.username}</span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-500 border-orange-500/20 flex-shrink-0"
                          >
                            <Flame className="w-3 h-3 mr-0.5" />
                            TRENDING
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {contributor.lastWeekCommits} commits in last 7 days
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-center text-muted-foreground mt-4 pt-4 border-t border-border">
                      Click to view details
                    </div>
                  </div>

                  {/* Back of card */}
                  <div
                    className="absolute inset-0 p-4 rounded-lg border border-border bg-secondary/50 overflow-hidden"
                    style={{
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <img
                          src={contributor.avatar || "/placeholder.svg"}
                          alt={contributor.username}
                          className="w-10 h-10 rounded-full ring-2 ring-border"
                        />
                        <div>
                          <p className="text-sm font-semibold font-mono">@{contributor.username}</p>
                          <p className="text-xs text-muted-foreground">{contributor.totalCommits} total commits</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(`https://github.com/${contributor.username}`, "_blank")
                        }}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        GitHub
                      </Button>
                    </div>

                    <div className="space-y-2 text-xs">
                      {contributor.contacts.email && (
                        <div
                          className="flex items-center gap-2 cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(contributor.contacts.email!)
                          }}
                        >
                          <Mail className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-primary hover:underline font-mono truncate">
                            {contributor.contacts.email}
                          </span>
                        </div>
                      )}
                      {contributor.contacts.twitter && (
                        <div
                          className="flex items-center gap-2 cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(`https://twitter.com/${contributor.contacts.twitter}`, "_blank")
                          }}
                        >
                          <XIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-primary hover:underline font-mono truncate">
                            @{contributor.contacts.twitter}
                          </span>
                        </div>
                      )}
                      {contributor.contacts.linkedin && (
                        <div
                          className="flex items-center gap-2 cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(`https://linkedin.com/in/${contributor.contacts.linkedin}`, "_blank")
                          }}
                        >
                          <Linkedin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-primary hover:underline font-mono truncate">
                            linkedin.com/in/{contributor.contacts.linkedin}
                          </span>
                        </div>
                      )}
                      {contributor.contacts.website && (
                        <div
                          className="flex items-center gap-2 cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(contributor.contacts.website!, "_blank")
                          }}
                        >
                          <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-primary hover:underline font-mono truncate">
                            {contributor.contacts.website}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-3 left-0 right-0 text-xs text-center text-muted-foreground">
                      Click to close
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
