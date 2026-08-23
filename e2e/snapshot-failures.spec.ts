import { expect, test, type Page, type Route } from "@playwright/test"

const permissions = { canRead: true, canWrite: true, canAdmin: true, canManageMembers: true }
const timestamp = "2026-01-15T12:00:00.000Z"

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function installCommonRoutes(page: Page) {
  await page.route("**/api/auth/me", (route) => fulfillJson(route, {
    authenticated: true,
    actor: "admin",
    permissions,
  }))
  await page.route("**/api/health", (route) => fulfillJson(route, { status: "ok" }))
  await page.route("**/api/activity-events**", (route) => fulfillJson(route, { events: [] }))
}

test("active scrape polling failure preserves progress and Retry recovers", async ({ page }) => {
  await installCommonRoutes(page)
  let pollCount = 0
  let recovering = false

  await page.route("**/api/ecosystems", (route) => fulfillJson(route, []))
  await page.route("**/api/scrapes/recent**", (route) => fulfillJson(route, {
    completed: [], failed: [], hasMore: false,
  }))
  await page.route("**/api/scrapes/active", (route) => {
    pollCount += 1
    if (pollCount > 2 && !recovering) {
      return fulfillJson(route, { error: "Temporary progress outage" }, 503)
    }
    return fulfillJson(route, {
      active: [{
        id: "scrape-stale-progress",
        target: "example/reliable-repo",
        type: "repository",
        progress: recovering ? 60 : 40,
        current: recovering ? 3 : 2,
        total: 5,
        startedAt: timestamp,
        job: {
          id: "00000000-0000-4000-8000-000000000002",
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
  })

  await page.goto("/")
  await expect(page.getByText("example/reliable-repo", { exact: true })).toBeVisible()
  await expect(page.getByText("40%", { exact: true })).toBeVisible()
  await expect(page.getByText("Active scrape progress could not refresh", { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("example/reliable-repo", { exact: true })).toBeVisible()
  await expect(page.getByText("40%", { exact: true })).toBeVisible()

  recovering = true
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("60%", { exact: true })).toBeVisible()
  await expect(page.getByText("Active scrape progress could not refresh", { exact: true })).toBeHidden()
})

test("failed Pipeline filter preserves the previous view until a valid retry", async ({ page }) => {
  await installCommonRoutes(page)
  let recoverFilteredView = false
  const pipelineItem = {
    tracking: {
      id: "tracking-browser-test",
      projectId: "project-browser-test",
      contributorId: "contributor-browser-test",
      status: "contacted",
      notes: "Follow up after the conference",
      lastContactedAt: "2026-01-10",
      nextFollowUpAt: "2026-01-20",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    contributor: {
      id: "contributor-browser-test",
      username: "pipeline-person",
      name: "Pipeline Person",
      avatar: "",
      bio: null,
      location: "New York, NY",
      company: "Example",
      contacts: { github: "https://github.com/pipeline-person" },
    },
    project: { id: "project-browser-test", name: "Platform Search" },
  }

  await page.route("**/api/pipeline**", (route) => {
    const status = new URL(route.request().url()).searchParams.get("status")
    if (status === "interested" && !recoverFilteredView) {
      return fulfillJson(route, { error: "Temporary Pipeline outage" }, 503)
    }
    return fulfillJson(route, {
      items: status === "interested" ? [] : [pipelineItem],
      projects: [{ id: "project-browser-test", name: "Platform Search" }],
      total: status === "interested" ? 0 : 1,
      hasMore: false,
    })
  })

  await page.goto("/pipeline")
  await expect(page.getByText("Pipeline Person", { exact: true })).toBeVisible()

  await page.getByRole("combobox").nth(1).click()
  await page.getByRole("option", { name: "Interested" }).click()

  await expect(page.getByText("Pipeline could not refresh", { exact: true })).toBeVisible()
  await expect(page.getByText("Showing the last successful view; the current filters were not applied.", { exact: true })).toBeVisible()
  await expect(page.getByText("Pipeline Person", { exact: true })).toBeVisible()

  recoverFilteredView = true
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("Pipeline could not refresh", { exact: true })).toBeHidden()
  await expect(page.getByText("Pipeline Person", { exact: true })).toBeHidden()
})
