// Shared in-memory storage for scrapes
// In production, replace with Redis, PostgreSQL, or another persistent store

export type ScrapeData = {
  id: string
  type: "organization" | "repository"
  target: string
  status: "active" | "completed" | "failed"
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: Date
  completedAt?: Date
  contributors: Array<{
    username: string
    name: string
    avatar: string
    contributions: number
    bio?: string
    location?: string
    company?: string
    contacts: {
      email?: string
      twitter?: string
      linkedin?: string
      website?: string
    }
  }>
  error?: string
}

export const scrapeStorage = new Map<string, ScrapeData>()
