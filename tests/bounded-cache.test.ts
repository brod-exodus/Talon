import test from "node:test"
import assert from "node:assert/strict"
import { setBoundedMapEntry } from "../lib/bounded-cache.ts"

test("setBoundedMapEntry evicts the oldest entry", () => {
  const current = new Map([
    ["one", [1]],
    ["two", [2]],
  ])
  const next = setBoundedMapEntry(current, "three", [3], 2)

  assert.deepEqual([...next.keys()], ["two", "three"])
  assert.deepEqual([...current.keys()], ["one", "two"])
})

test("setBoundedMapEntry refreshes an existing entry's recency", () => {
  const current = new Map([
    ["one", [1]],
    ["two", [2]],
  ])
  const next = setBoundedMapEntry(current, "one", [10], 2)

  assert.deepEqual([...next.keys()], ["two", "one"])
  assert.deepEqual(next.get("one"), [10])
})
