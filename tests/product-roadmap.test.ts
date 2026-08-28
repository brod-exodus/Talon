import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const roadmap = readFileSync(resolve(import.meta.dirname, "../docs/roadmap.md"), "utf8")
const validation = readFileSync(resolve(import.meta.dirname, "../docs/product-validation.md"), "utf8")
const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8")

test("roadmap prioritizes validated sourcing outcomes before speculative features", () => {
  const validationPriority = roadmap.indexOf("Validate the sourcing outcome with real operators")
  const graphPriority = roadmap.indexOf("Explore ecosystem relationships and contributor movement")

  assert.ok(validationPriority > -1)
  assert.ok(graphPriority > validationPriority)
  assert.match(roadmap, /Blocked by sender-domain availability/)
  assert.match(roadmap, /permission to stop changing the workflow/)
})

test("validation protocol records aggregate outcomes without candidate data", () => {
  assert.match(validation, /Do not record contributor names, usernames, contact details/)
  assert.match(validation, /Run three sessions/)
  assert.match(validation, /median time to a completed contactable list/)
  assert.match(validation, /keep the workflow unchanged/)
})

test("repository entry point links the sourcing validation protocol", () => {
  assert.match(readme, /\[Sourcing validation protocol\]\(docs\/product-validation\.md\)/)
  assert.match(readme, /validate its existing contact-focused sourcing workflow/)
})
