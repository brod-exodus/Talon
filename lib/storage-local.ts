export type ScrapeData = {
  id: string
  type: "organization" | "repository"
  target: string
  role?: string
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
    contacted?: boolean
    contactedDate?: string
    contactedMethod?: string
    contactedNotes?: string
  }>
  error?: string
}

const STORAGE_KEY = "github-scraper-data"
const ROLES_KEY = "github-scraper-roles"

function getStorage(): { scrapes: ScrapeData[] } {
  if (typeof window === "undefined") return { scrapes: [] }
  const data = localStorage.getItem(STORAGE_KEY)
  if (!data) return { scrapes: [] }
  try {
    const parsed = JSON.parse(data)
    return {
      scrapes: parsed.scrapes.map((s: ScrapeData) => ({
        ...s,
        startedAt: new Date(s.startedAt),
        completedAt: s.completedAt ? new Date(s.completedAt) : undefined,
      })),
    }
  } catch {
    return { scrapes: [] }
  }
}

function saveStorage(data: { scrapes: ScrapeData[] }) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function getScrape(id: string): Promise<ScrapeData | null> {
  const storage = getStorage()
  return storage.scrapes.find((s) => s.id === id) || null
}

export async function createScrape(scrape: Omit<ScrapeData, "contributors">): Promise<void> {
  const storage = getStorage()
  storage.scrapes.push({ ...scrape, contributors: [] })
  saveStorage(storage)
}

export async function updateScrape(
  id: string,
  updates: Partial<Omit<ScrapeData, "id" | "contributors">>,
): Promise<void> {
  const storage = getStorage()
  const scrape = storage.scrapes.find((s) => s.id === id)
  if (scrape) {
    Object.assign(scrape, updates)
    saveStorage(storage)
  }
}

export async function addContributor(scrapeId: string, contributor: ScrapeData["contributors"][0]): Promise<void> {
  const storage = getStorage()
  const scrape = storage.scrapes.find((s) => s.id === scrapeId)
  if (scrape) {
    scrape.contributors.push(contributor)
    saveStorage(storage)
  }
}

export async function getAllScrapes(): Promise<{
  active: Array<Omit<ScrapeData, "contributors">>
  completed: ScrapeData[]
}> {
  const storage = getStorage()
  const active = storage.scrapes.filter((s) => s.status === "active").map(({ contributors, ...rest }) => rest)
  const completed = storage.scrapes.filter((s) => s.status === "completed")
  return { active, completed }
}

export async function deleteScrape(id: string): Promise<void> {
  const storage = getStorage()
  storage.scrapes = storage.scrapes.filter((s) => s.id !== id)
  saveStorage(storage)
}

export async function updateContributorOutreach(
  scrapeId: string,
  username: string,
  outreach: {
    contacted: boolean
    contactedDate?: string
    contactedMethod?: string
    contactedNotes?: string
  },
): Promise<void> {
  const storage = getStorage()
  const scrape = storage.scrapes.find((s) => s.id === scrapeId)
  if (scrape) {
    const contributor = scrape.contributors.find((c) => c.username === username)
    if (contributor) {
      Object.assign(contributor, outreach)
      saveStorage(storage)
    }
  }
}

export async function getRoles(): Promise<string[]> {
  if (typeof window === "undefined") return []
  const data = localStorage.getItem(ROLES_KEY)
  return data ? JSON.parse(data) : []
}

export async function addRole(name: string): Promise<void> {
  const roles = await getRoles()
  if (!roles.includes(name)) {
    roles.push(name)
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles))
  }
}

export async function deleteRole(name: string): Promise<void> {
  const roles = await getRoles()
  const filtered = roles.filter((r) => r !== name)
  localStorage.setItem(ROLES_KEY, JSON.stringify(filtered))
}

export async function updateRole(oldName: string, newName: string): Promise<void> {
  const roles = await getRoles()
  const index = roles.indexOf(oldName)
  if (index !== -1) {
    roles[index] = newName
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles))
  }

  // Update scrapes with this role
  const storage = getStorage()
  storage.scrapes.forEach((scrape) => {
    if (scrape.role === oldName) {
      scrape.role = newName
    }
  })
  saveStorage(storage)
}
