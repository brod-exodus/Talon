import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { once } from "node:events"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}

test("production smoke exercises cancel, retry, completion, export, sharing, and cleanup", async () => {
  const requests: Array<{ method: string; path: string }> = []
  let queuedScrapes = 0
  let shareRevoked = false
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    requests.push({ method: request.method ?? "GET", path: url.pathname })

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      response.setHeader("Set-Cookie", "talon_session=test; Path=/")
      return json(response, 200, { success: true })
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        status: "ok",
        checks: {
          github: { status: "ok" },
          database: { status: "ok" },
          scrapeWorker: { status: "ok" },
          keepalive: { status: "ok" },
        },
      })
    }
    if (request.method === "POST" && url.pathname === "/api/scrape") {
      queuedScrapes++
      return json(response, 202, {
        scrapeId: `scrape-${queuedScrapes}`,
        jobId: `00000000-0000-4000-8000-00000000000${queuedScrapes}`,
        status: "queued",
      })
    }
    if (request.method === "POST" && /\/api\/scrape-jobs\/[^/]+\/cancel$/.test(url.pathname)) {
      return json(response, 200, {
        job: {
          id: "00000000-0000-4000-8000-000000000001",
          scrapeId: "scrape-1",
          status: "canceled",
        },
      })
    }
    if (request.method === "POST" && /\/api\/scrape-jobs\/[^/]+\/retry$/.test(url.pathname)) {
      return json(response, 200, {
        job: { id: "00000000-0000-4000-8000-000000000001", status: "queued" },
        workerTriggered: true,
        workerResult: { status: "succeeded" },
      })
    }
    if (request.method === "GET" && url.pathname === "/api/scrape/scrape-1") {
      return json(response, 200, {
        id: "scrape-1",
        status: "canceled",
        contributors: [],
        contributorTotal: 0,
      })
    }
    if (request.method === "GET" && url.pathname === "/api/scrape/scrape-2") {
      return json(response, 200, {
        id: "scrape-2",
        status: "completed",
        contributorTotal: 1,
        contributors: [
          {
            id: "contributor-1",
            username: "octocat",
            name: "The Octocat",
            contributions: 1,
            contacts: { email: "octocat@example.com" },
          },
        ],
      })
    }
    if (request.method === "POST" && url.pathname === "/api/share") {
      return json(response, 200, {
        token: "smoke-share-token-1234567890123456",
        share: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          scrapeId: "scrape-2",
          expiresAt: "2026-08-14T12:00:00Z",
          allowDownload: true,
        },
      })
    }
    if (request.method === "GET" && url.pathname === "/api/share/smoke-share-token-1234567890123456") {
      if (shareRevoked) return json(response, 410, { error: "This share link is no longer available" })
      return json(response, 200, {
        id: "scrape-2",
        contributors: [{ username: "octocat" }],
        share: { expiresAt: "2026-08-14T12:00:00Z", allowDownload: true },
      })
    }
    if (request.method === "DELETE" && url.pathname === "/api/share") {
      shareRevoked = true
      return json(response, 200, {
        share: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revokedAt: "2026-08-13T12:00:00Z" },
      })
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/scrape/")) {
      return json(response, 200, { success: true })
    }

    return json(response, 404, { error: `Unhandled fake route ${request.method} ${url.pathname}` })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address === "object")

  try {
    const child = spawn("bash", ["./scripts/smoke-production.sh"], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        BASE_URL: `http://127.0.0.1:${address.port}`,
        ADMIN_EMAIL: "operator@example.com",
        ADMIN_PASSWORD: "test-password",
        SMOKE_REPO: "octocat/Hello-World",
        POLL_SECONDS: "0",
        MAX_POLLS: "2",
        CANCEL_SETTLE_SECONDS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const [exitCode] = await once(child, "close")

    assert.equal(exitCode, 0, `stdout:\n${stdout}\nstderr:\n${stderr}`)
    assert.match(stdout, /Production smoke passed/)
    assert.equal(requests.filter((entry) => entry.method === "POST" && entry.path === "/api/scrape").length, 2)
    assert.equal(requests.filter((entry) => entry.method === "DELETE" && entry.path.startsWith("/api/scrape/")).length, 2)
    assert.ok(requests.some((entry) => entry.path === "/api/share/smoke-share-token-1234567890123456"))
  } finally {
    server.close()
    await once(server, "close")
  }
})
