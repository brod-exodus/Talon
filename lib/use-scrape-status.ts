"use client"

import { useEffect, useState } from "react"

export interface ScrapeStatus {
  id: string
  type: string
  target: string
  status: "processing" | "completed" | "failed" | "error"
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: string
  completedAt?: string
  error?: string
}

export function useScrapeStatus(scrapeId: string | null) {
  const [status, setStatus] = useState<ScrapeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!scrapeId) return

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/scrape/${scrapeId}?page=1`)
        if (!response.ok) throw new Error("Failed to fetch status")

        const data = await response.json()
        setStatus(data)

        // Stop polling if completed or failed
        if (data.status === "completed" || data.status === "failed" || data.status === "error") {
          clearInterval(interval)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
        clearInterval(interval)
      }
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [scrapeId])

  return { status, error }
}
