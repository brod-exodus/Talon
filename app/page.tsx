"use client"

import { useRef, useCallback } from "react"
import { Header } from "@/components/header"
import { ScrapeForm } from "@/components/scrape-form"
import { ActiveScrapes } from "@/components/active-scrapes"
import { RecentScrapes, type RecentScrapesHandle } from "@/components/recent-scrapes"
import { RecruiterWorkflowGuide } from "@/components/recruiter-workflow-guide"

export default function Home() {
  const recentScrapesRef = useRef<RecentScrapesHandle>(null)

  const handleScrapeCompleted = useCallback(() => {
    recentScrapesRef.current?.refresh()
  }, [])

  return (
    <div className="prism-app">
      <Header />

      <main className="prism-main">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Dashboard</h1>
          </div>
        </div>

        <div className="mb-6">
          <RecruiterWorkflowGuide compact />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
          <div className="xl:col-span-1">
            <ScrapeForm />
          </div>

          <div className="space-y-4 sm:space-y-6 xl:col-span-2">
            <ActiveScrapes onScrapeCompleted={handleScrapeCompleted} />
            <RecentScrapes ref={recentScrapesRef} />
          </div>
        </div>
      </main>
    </div>
  )
}
