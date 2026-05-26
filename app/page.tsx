"use client"

import { useRef, useCallback } from "react"
import { Header } from "@/components/header"
import { ScrapeForm } from "@/components/scrape-form"
import { ActiveScrapes } from "@/components/active-scrapes"
import { FollowUpQueue } from "@/components/follow-up-queue"
import { RecentScrapes, type RecentScrapesHandle } from "@/components/recent-scrapes"

export default function Home() {
  const recentScrapesRef = useRef<RecentScrapesHandle>(null)

  const handleScrapeCompleted = useCallback(() => {
    recentScrapesRef.current?.refresh()
  }, [])

  return (
    <div className="prism-app">
      <Header />

      <main className="prism-main">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="prism-section-title">Dashboard</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Contributor discovery workspace
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
              Start targeted GitHub scrapes, monitor active work, and turn completed contributor lists into recruiter-ready outreach.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
          <div className="xl:col-span-1">
            <ScrapeForm />
          </div>

          <div className="space-y-4 sm:space-y-6 xl:col-span-2">
            <ActiveScrapes onScrapeCompleted={handleScrapeCompleted} />
            <FollowUpQueue />
            <RecentScrapes ref={recentScrapesRef} />
          </div>
        </div>
      </main>
    </div>
  )
}
