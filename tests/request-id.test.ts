import test from "node:test"
import assert from "node:assert/strict"
import { getRequestId, normalizeRequestId } from "../lib/request-id.ts"

test("request IDs accept only normalized UUIDs", () => {
  assert.equal(
    normalizeRequestId(" AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA "),
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  )
  assert.equal(normalizeRequestId("caller-controlled-log-text"), null)
  assert.equal(normalizeRequestId(null), null)
})

test("getRequestId preserves a valid ID and generates a safe fallback", () => {
  const existing = new Request("https://talon.example", {
    headers: { "X-Request-ID": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  })
  assert.equal(getRequestId(existing), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

  const generated = getRequestId(new Request("https://talon.example"))
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
