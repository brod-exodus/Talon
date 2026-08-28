import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const

const scrapeId = "scrape-accessibility-test"
const timestamp = "2026-01-15T12:00:00.000Z"

async function installRecruiterWorkspaceFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })

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
    if (url.pathname === "/api/scrapes/active") {
      return json({ active: [], completed: [], failed: [] })
    }
    if (url.pathname === "/api/scrapes/recent") {
      return json({
        completed: [{
          id: scrapeId,
          target: "octocat/Hello-World",
          type: "repository",
          completedAt: timestamp,
          contributorCount: 1,
          contactInfoCount: 1,
          projects: [],
          job: { id: "00000000-0000-4000-8000-000000000001", status: "succeeded", attempts: 1, maxAttempts: 3, lastError: null },
        }],
        failed: [],
        hasMore: false,
      })
    }
    if (url.pathname === `/api/scrape/${scrapeId}`) {
      return json({
        id: scrapeId,
        type: "repository",
        target: "octocat/Hello-World",
        status: "completed",
        progress: 100,
        current: 1,
        total: 1,
        startedAt: timestamp,
        completedAt: timestamp,
        contributors: [{
          id: "contributor-accessibility-test",
          username: "octocat",
          name: "The Octocat",
          avatar: "",
          bio: "GitHub mascot",
          company: "GitHub",
          location: "New York, NY",
          contributions: 42,
          contacts: { email: "octocat@example.com", website: "https://github.com/octocat" },
        }],
        contributorTotal: 1,
        page: 1,
        hasMore: false,
      })
    }
    if (url.pathname === "/api/pipeline") {
      return json({
        items: [{
          tracking: {
            id: "tracking-accessibility-test",
            projectId: "project-accessibility-test",
            contributorId: "contributor-accessibility-test",
            status: "contacted",
            notes: "Follow up after the conference",
            lastContactedAt: "2026-01-10",
            nextFollowUpAt: "2026-01-20",
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          contributor: {
            id: "contributor-accessibility-test",
            username: "octocat",
            name: "The Octocat",
            avatar: "",
            bio: "GitHub mascot",
            location: "New York, NY",
            company: "GitHub",
            contacts: { email: "octocat@example.com", github: "https://github.com/octocat" },
          },
          project: { id: "project-accessibility-test", name: "Platform Search" },
        }],
        projects: [{ id: "project-accessibility-test", name: "Platform Search" }],
        total: 1,
        hasMore: false,
      })
    }

    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unmocked accessibility-test route: ${request.method()} ${url.pathname}` }),
    })
  })
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLElement>("[style*='opacity']"))
    .filter((element) => element.getClientRects().length > 0)
    .every((element) => Number.parseFloat(getComputedStyle(element).opacity) === 1))
  const results = await new AxeBuilder({ page }).analyze()
  const violations = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")

  expect(violations, violations.map(({ id, help, nodes }) =>
    `${id}: ${help} (${nodes.length} node${nodes.length === 1 ? "" : "s"})`
  ).join("\n")).toEqual([])
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }))

  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
}

for (const viewport of viewports) {
  test(`${viewport.name} recruiter workflow passes the accessibility gate`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await installRecruiterWorkspaceFixture(page)

    await page.goto("/login")
    await expect(page.getByRole("main")).toContainText("Sign in with your team email and password.")
    await expectNoSeriousAccessibilityViolations(page)
    await expectNoHorizontalPageOverflow(page)

    await page.getByLabel("Email").fill("operator@example.com")
    await page.getByLabel("Password").fill("browser-test-password")
    await page.getByRole("button", { name: "Sign In" }).click()

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Completed Scrapes" })).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page)
    await expectNoHorizontalPageOverflow(page)

    await page.getByRole("button", { name: "View Contributors (1)" }).click()
    await expect(page.getByRole("button", { name: "Hide Contributors" })).toBeVisible()
    const candidateName = page.getByText("The Octocat", { exact: true })
    await candidateName.scrollIntoViewIfNeeded()
    await expect(candidateName).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("octocat@example.com", { exact: true })).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page)
    await expectNoHorizontalPageOverflow(page)

    await page.goto("/pipeline")
    await expect(page.getByRole("heading", { name: "Outreach workflow" })).toBeVisible()
    await expect(page.getByText("The Octocat", { exact: true })).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page)
    await expectNoHorizontalPageOverflow(page)
  })
}
