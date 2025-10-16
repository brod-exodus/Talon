import { Card } from "@/components/ui/card"
import { TrendingUp, Users, GitBranch, Zap } from "lucide-react"

interface TalentStatsProps {
  poolId: string
}

export function TalentStats({ poolId }: TalentStatsProps) {
  const statsData: Record<string, typeof stats> = {
    all: [
      { label: "Total Contributors", value: "847", change: "+23%", icon: Users, trend: "up" },
      { label: "Active Projects", value: "12", change: "+3", icon: GitBranch, trend: "up" },
      { label: "Rising Stars", value: "67", change: "+12", icon: TrendingUp, trend: "up" },
      { label: "High Momentum", value: "234", change: "+45%", icon: Zap, trend: "up" },
    ],
    "ml-engineer": [
      { label: "Total Contributors", value: "234", change: "+18%", icon: Users, trend: "up" },
      { label: "Active Projects", value: "5", change: "+1", icon: GitBranch, trend: "up" },
      { label: "Rising Stars", value: "23", change: "+8", icon: TrendingUp, trend: "up" },
      { label: "High Momentum", value: "89", change: "+32%", icon: Zap, trend: "up" },
    ],
    "solana-engineer": [
      { label: "Total Contributors", value: "156", change: "+28%", icon: Users, trend: "up" },
      { label: "Active Projects", value: "4", change: "+2", icon: GitBranch, trend: "up" },
      { label: "Rising Stars", value: "19", change: "+6", icon: TrendingUp, trend: "up" },
      { label: "High Momentum", value: "67", change: "+51%", icon: Zap, trend: "up" },
    ],
    "inference-ops": [
      { label: "Total Contributors", value: "189", change: "+15%", icon: Users, trend: "up" },
      { label: "Active Projects", value: "3", change: "+1", icon: GitBranch, trend: "up" },
      { label: "Rising Stars", value: "15", change: "+5", icon: TrendingUp, trend: "up" },
      { label: "High Momentum", value: "78", change: "+38%", icon: Zap, trend: "up" },
    ],
  }

  const stats = statsData[poolId] || statsData.all

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card
            key={stat.label}
            className="p-4 bg-card/50 backdrop-blur border-border/50 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-success font-medium">{stat.change}</span>
            </div>
            <div className="text-2xl font-bold mb-1">{stat.value}</div>
            <div className="text-xs text-muted-foreground">{stat.label}</div>
          </Card>
        )
      })}
    </div>
  )
}
