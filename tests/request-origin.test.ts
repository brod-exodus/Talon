import assert from "node:assert/strict"
import test from "node:test"
import { isTrustedRequestOrigin } from "../lib/request-origin-rules.ts"

function request(options: {
  method?: string
  origin?: string
  fetchSite?: string
  url?: string
} = {}) {
  const url = new URL(options.url ?? "https://talon.example/api/scrape")
  const headers = new Headers()
  if (options.origin !== undefined) headers.set("Origin", options.origin)
  if (options.fetchSite !== undefined) headers.set("Sec-Fetch-Site", options.fetchSite)
  return { method: options.method ?? "POST", headers, nextUrl: url }
}

test("same-origin browser mutations are trusted", () => {
  assert.equal(isTrustedRequestOrigin(request({
    origin: "https://talon.example",
    fetchSite: "same-origin",
  })), true)
})

test("cross-site and malformed browser origins are rejected", () => {
  assert.equal(isTrustedRequestOrigin(request({
    origin: "https://attacker.example",
    fetchSite: "cross-site",
  })), false)
  assert.equal(isTrustedRequestOrigin(request({ origin: "null" })), false)
  assert.equal(isTrustedRequestOrigin(request({ origin: "not a URL" })), false)
})

test("safe reads remain compatible while originless writes fail closed", () => {
  assert.equal(isTrustedRequestOrigin(request({
    method: "GET",
    origin: "https://attacker.example",
    fetchSite: "cross-site",
  })), true)
  assert.equal(isTrustedRequestOrigin(request()), false)
  assert.equal(isTrustedRequestOrigin(request({ fetchSite: "cross-site" })), false)
})

test("same-origin Referer is an accepted fallback when Origin is unavailable", () => {
  const headers = new Headers({ Referer: "https://talon.example/settings" })
  assert.equal(isTrustedRequestOrigin({
    method: "POST",
    headers,
    nextUrl: new URL("https://talon.example/api/slack/test"),
  }), true)
})
