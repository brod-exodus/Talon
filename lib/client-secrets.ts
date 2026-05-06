const GITHUB_TOKEN_KEY = "github_token"

export function getStoredGithubToken(): { token: string | null; persisted: boolean } {
  if (typeof window === "undefined") {
    return { token: null, persisted: false }
  }

  const persistedToken = localStorage.getItem(GITHUB_TOKEN_KEY)
  if (persistedToken) {
    return { token: persistedToken, persisted: true }
  }

  const sessionToken = sessionStorage.getItem(GITHUB_TOKEN_KEY)
  return { token: sessionToken, persisted: false }
}

export function storeGithubToken(token: string, persist: boolean): void {
  if (typeof window === "undefined") return

  localStorage.removeItem(GITHUB_TOKEN_KEY)
  sessionStorage.removeItem(GITHUB_TOKEN_KEY)

  const value = token.trim()
  if (!value) return

  if (persist) {
    localStorage.setItem(GITHUB_TOKEN_KEY, value)
    return
  }

  sessionStorage.setItem(GITHUB_TOKEN_KEY, value)
}

export function clearStoredGithubToken(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(GITHUB_TOKEN_KEY)
  sessionStorage.removeItem(GITHUB_TOKEN_KEY)
}

