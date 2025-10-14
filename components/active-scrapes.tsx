"use client"

import { useEffect, useState, memo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Activity, Users, Clock } from "lucide-react"
import { motion } from "framer-motion"
import { Skeleton } from "@/components/ui/skeleton"

type ActiveScrape = {
  id: string
  target: string
  type: string
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: Date
}

export const ActiveScrapes = memo(function ActiveScrapes() {
  const [scrapes, setScrapes] = useState<ActiveScrape[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const response = await fetch("/api/scrapes")
        const data = await response.json()
        setScrapes(data.active || [])
      } catch (error) {
        console.error("[v0] Failed to fetch scrapes:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchScrapes()
    const interval = setInterval(fetchScrapes, 2000)
    return () => clearInterval(interval)
  }, [])

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    const hours = Math.floor(minutes / 60)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card className="border-border bg-card">
          <CardHeader>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (scrapes.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Active Scrapes</h2>
      </div>

      <div className="space-y-4">
        {scrapes.map((scrape, index) => (
          <motion.div
            key={scrape.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className="border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-mono">{scrape.target}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                        {scrape.type}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(scrape.startedAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/20 animate-pulse">
                    Processing
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Processing contributor
                    </span>
                    <motion.span
                      key={`${scrape.current}-${scrape.total}`}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="font-mono text-foreground"
                    >
                      {scrape.current} / {scrape.total}
                    </motion.span>
                  </div>
                  <Progress value={scrape.progress} className="h-2 transition-all duration-300" />
                </div>

                {scrape.currentUser && (
                  <div className="pt-2 border-t border-border">
                    <motion.p
                      key={scrape.currentUser}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-sm text-muted-foreground"
                    >
                      Current: <span className="font-mono text-foreground">{scrape.currentUser}</span>
                    </motion.p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
})
