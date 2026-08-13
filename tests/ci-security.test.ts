import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "..")

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8")
}

test("third-party GitHub Actions are pinned to immutable commits", () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/security.yml"]) {
    const workflow = read(path)
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1])
    assert.ok(uses.length > 0, `${path} must use at least one action`)
    for (const action of uses) {
      assert.match(action, /@[0-9a-f]{40}$/, `${path} contains a mutable action reference: ${action}`)
    }
  }
})

test("the security workflow keeps permissions narrow and runs both security gates", () => {
  const workflow = read(".github/workflows/security.yml")
  assert.match(workflow, /^permissions:\n  contents: read$/m)
  assert.match(workflow, /actions\/dependency-review-action@/)
  assert.match(workflow, /github\/codeql-action\/init@/)
  assert.match(workflow, /security-events: write/)
  assert.doesNotMatch(workflow, /permissions:\s*write-all/)
})

test("Dependabot covers application and workflow dependencies", () => {
  const config = read(".github/dependabot.yml")
  assert.match(config, /package-ecosystem: npm/)
  assert.match(config, /package-ecosystem: github-actions/)
  assert.match(config, /interval: weekly/)
})

test("CI blocks high-severity dependency advisories", () => {
  const ci = read(".github/workflows/ci.yml")
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> }
  assert.match(ci, /pnpm security:audit/)
  assert.equal(packageJson.scripts?.["security:audit"], "pnpm audit --audit-level=high")
})
