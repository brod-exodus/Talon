import { defineConfig, devices } from "@playwright/test"

const port = 3100

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy",
      SUPABASE_SERVICE_ROLE_KEY: "dummy",
      TALON_ADMIN_PASSWORD: "",
      TALON_SESSION_SECRET: "",
      GITHUB_TOKEN: "dummy",
    },
  },
})
