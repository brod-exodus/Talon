import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const scrapeId = "scrape-browser-test"
const jobId = "00000000-0000-4000-8000-000000000001"
const target = "octocat/Hello-World"
const timestamp = "2026-01-15T12:00:00.000Z"

async function installApiFixture(page: Page) {
  let accepted = false
  let activePollsAfterAcceptance = 0
  let completed = false

  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) })

    if (url.pathname === "/api/auth/login" && request.method() === "POST") {
      return json({ success: true })
    }
    if (url.pathname === "/api/auth/me") {
      return json({
        authenticated: true,
        actor: "admin",
        permissions: { canRead: true, canWrite: true, canAdmin: true, canManageMembers: true },
      })
    }
    if (url.pathname === "/api/ecosystems") return json([])
    if (url.pathname === "/api/health") return json({ status: "ok" })
    if (url.pathname === "/api/activity-events") return json({ events: [] })

    if (url.pathname === "/api/scrape" && request.method() === "POST") {
      accepted = true
      return json({ scrapeId, jobId, status: "queued", replayed: false }, 202)
    }

    if (url.pathname === "/api/scrapes/active") {
      if (!accepted) return json({ active: [], completed: [], failed: [] })
      activePollsAfterAcceptance += 1
      if (activePollsAfterAcceptance <= 2) {
        return json({
          active: [{
            id: scrapeId,
            target,
            type: "repository",
            progress: 35,
            current: 1,
            total: 3,
            startedAt: timestamp,
            job: {
              id: jobId,
              status: "running",
              attempts: 1,
              maxAttempts: 3,
              runAfter: timestamp,
              lockedAt: timestamp,
              lastError: null,
            },
          }],
          completed: [],
          failed: [],
        })
      }
      completed = true
      return json({ active: [], completed: [{ id: scrapeId }], failed: [] })
    }

    if (url.pathname === "/api/scrapes/recent") {
      return json({
        completed: completed ? [{
          id: scrapeId,
          target,
          type: "repository",
          completedAt: timestamp,
          contributorCount: 2,
          contactInfoCount: 1,
          projects: [],
          job: { id: jobId, status: "succeeded", attempts: 1, maxAttempts: 3, lastError: null },
        }] : [],
        failed: [],
        hasMore: false,
      })
    }

    if (url.pathname === `/api/scrape/${scrapeId}`) {
      return json({
        id: scrapeId,
        type: "repository",
        target,
        status: "completed",
        progress: 100,
        current: 2,
        total: 2,
        startedAt: timestamp,
        completedAt: timestamp,
        contributors: [
          {
            id: "contributor-browser-test",
            username: "octocat",
            name: "The Octocat",
            avatar: "",
            bio: "GitHub mascot",
            company: "GitHub",
            location: "San Francisco",
            contributions: 42,
            contacts: { email: "octocat@example.com", website: "https://github.com/octocat" },
          },
          {
            id: "contributor-without-contacts",
            username: "hubot",
            name: "Hubot",
            avatar: "",
            bio: "Automation contributor",
            company: "GitHub",
            location: "The Internet",
            contributions: 7,
            contacts: {},
          },
        ],
        contributorTotal: 2,
        page: 1,
        hasMore: false,
      })
    }

    return json({ error: `Unmocked browser-test route: ${request.method()} ${url.pathname}` }, 501)
  })
}

test("login, queue a scrape, observe completion, inspect contributors, and export CSV", async ({ page }) => {
  await installApiFixture(page)

  await page.goto("/login")
  await page.getByLabel("Email").fill("operator@example.com")
  await page.getByLabel("Password").fill("browser-test-password")
  await page.getByRole("button", { name: "Sign In" }).click()

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  await page.getByLabel("Repository").fill(target)
  const acceptancePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/scrape" && response.request().method() === "POST"
  )
  await page.getByRole("button", { name: "Start Scrape" }).click()

  const acceptance = await acceptancePromise
  expect(acceptance.status()).toBe(202)
  await expect(page.getByRole("heading", { name: "Active Scrapes" })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(target, { exact: true }).first()).toBeVisible()

  await expect(page.getByRole("button", { name: "View Contributors (2)" })).toBeVisible({ timeout: 10_000 })
  await page.getByRole("button", { name: "View Contributors (2)" }).click()
  await expect(page.getByText("The Octocat", { exact: true })).toBeVisible()
  await expect(page.getByText("Hubot", { exact: true })).toBeVisible()
  await expect(page.getByText("octocat@example.com", { exact: true })).toBeVisible()
  const mergedPullRequestsHref = await page.getByRole("link", { name: "Merged PRs" }).first().getAttribute("href")
  expect(mergedPullRequestsHref).toBeTruthy()
  const mergedPullRequestsUrl = new URL(mergedPullRequestsHref!)
  expect(mergedPullRequestsUrl.origin).toBe("https://github.com")
  expect(mergedPullRequestsUrl.pathname).toBe("/search")
  expect(mergedPullRequestsUrl.searchParams.get("q")).toBe(
    "repo:octocat/Hello-World is:pr is:merged author:octocat"
  )
  expect(mergedPullRequestsUrl.searchParams.get("type")).toBe("pullrequests")

  await page.getByRole("checkbox", { name: "Email", exact: true }).check()
  await expect(page.getByText("The Octocat", { exact: true })).toBeVisible()
  await expect(page.getByText("Hubot", { exact: true })).toBeHidden()

  await page.getByRole("button", { name: /Download/ }).click()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "CSV" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("octocat-Hello-World-contributors.csv")
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const csv = await readFile(downloadPath!, "utf8")
  expect(csv).toContain("octocat@example.com")
  expect(csv).not.toContain("hubot")
})
