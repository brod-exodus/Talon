import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const

async function installDashboardFixture(page: Page) {
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
      return json({ completed: [], failed: [], hasMore: false })
    }

    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unmocked accessibility-test route: ${request.method()} ${url.pathname}` }),
    })
  })
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  })
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
  test(`${viewport.name} login and dashboard pass the accessibility gate`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await installDashboardFixture(page)

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
  })
}
