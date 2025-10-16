"use client"

import { useState } from "react"
import { Header } from "@/components/header"
import { TalentNetworkGraph } from "@/components/talent-map/network-graph"
import { SkillClusters } from "@/components/talent-map/skill-clusters"
import { ActivityTimeline } from "@/components/talent-map/activity-timeline"
import { TalentStats } from "@/components/talent-map/talent-stats"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ArrowLeft, Download, Filter, Plus } from "lucide-react"
import Link from "next/link"

type TalentPool = {
  id: string
  name: string
  description: string
  repoCount: number
  contributorCount: number
}

const talentPools: TalentPool[] = [
  {
    id: "all",
    name: "All Talent",
    description: "Complete view of all tracked contributors",
    repoCount: 12,
    contributorCount: 847,
  },
  {
    id: "ml-engineer",
    name: "ML Engineer",
    description: "PyTorch, Hugging Face, model training & inference",
    repoCount: 5,
    contributorCount: 234,
  },
  {
    id: "solana-engineer",
    name: "Staff Solana Engineer",
    description: "Solana ecosystem, Rust, blockchain infrastructure",
    repoCount: 4,
    contributorCount: 156,
  },
  {
    id: "inference-ops",
    name: "Inference Ops",
    description: "LLM serving, optimization, distributed systems",
    repoCount: 3,
    contributorCount: 189,
  },
]

export default function TalentMapPage() {
  const [activePool, setActivePool] = useState("all")

  return (
    <div className="min-h-screen bg-background relative">
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl relative z-10">
        {/* Page Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-bold tracking-tight">Talent Map</h1>
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                  Preview
                </Badge>
              </div>
              <p className="text-muted-foreground text-lg">
                Visualize contributor networks, track activity patterns, and identify rising talent across open source
                communities
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={activePool} onValueChange={setActivePool} className="space-y-6">
          <div className="flex items-center gap-4 overflow-x-auto pb-2">
            <TabsList className="inline-flex h-auto p-1 bg-muted/50">
              {talentPools.map((pool) => (
                <TabsTrigger
                  key={pool.id}
                  value={pool.id}
                  className="data-[state=active]:bg-background data-[state=active]:text-foreground px-4 py-2"
                >
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="font-medium text-sm">{pool.name}</span>
                    <span className="text-xs text-muted-foreground">{pool.contributorCount} contributors</span>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>
            <Button variant="outline" size="sm" className="shrink-0 bg-transparent">
              <Plus className="w-4 h-4 mr-2" />
              New Pool
            </Button>
          </div>

          {talentPools.map((pool) => (
            <TabsContent key={pool.id} value={pool.id} className="space-y-6 mt-0">
              {/* Pool Description */}
              <Card className="p-4 bg-card/30 border-border/50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium mb-1">{pool.name}</h3>
                    <p className="text-sm text-muted-foreground">{pool.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <div className="text-muted-foreground">Repositories</div>
                      <div className="font-semibold">{pool.repoCount}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">Contributors</div>
                      <div className="font-semibold">{pool.contributorCount}</div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Stats Overview */}
              <TalentStats poolId={pool.id} />

              {/* Main Visualizations */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Network Graph */}
                <Card className="p-4 bg-card/50 backdrop-blur border-border/50 overflow-hidden isolate">
                  <div className="mb-3">
                    <h2 className="text-xl font-semibold mb-1">Contributor Network</h2>
                    <p className="text-sm text-muted-foreground">Relationships between contributors and projects</p>
                  </div>
                  <TalentNetworkGraph poolId={pool.id} />
                </Card>

                {/* Skill Clusters */}
                <Card className="p-4 bg-card/50 backdrop-blur border-border/50 overflow-hidden isolate">
                  <div className="mb-3">
                    <h2 className="text-xl font-semibold mb-1">Skill Clusters</h2>
                    <p className="text-sm text-muted-foreground">Technical expertise and domain specialization</p>
                  </div>
                  <SkillClusters poolId={pool.id} />
                </Card>
              </div>

              {/* Activity Timeline */}
              <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-1">Activity & Momentum</h2>
                  <p className="text-sm text-muted-foreground">Contribution patterns and rising stars over time</p>
                </div>
                <ActivityTimeline poolId={pool.id} />
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  )
}
