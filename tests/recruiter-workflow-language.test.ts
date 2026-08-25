import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

async function source(path: string) {
  return readFile(new URL(path, root), "utf8")
}

test("the primary recruiter workflow is visible on discovery, project, and pipeline surfaces", async () => {
  const [guide, dashboard, project, pipeline] = await Promise.all([
    source("components/recruiter-workflow-guide.tsx"),
    source("app/page.tsx"),
    source("app/ecosystems/[id]/page.tsx"),
    source("app/pipeline/page.tsx"),
  ])

  assert.match(guide, /1\. Discover/)
  assert.match(guide, /2\. Organize/)
  assert.match(guide, /3\. Outreach/)
  assert.match(guide, /Contributor notes and reminders follow the person everywhere/)
  assert.match(guide, /Outreach status, outreach notes, and follow-ups belong to one Project/)
  assert.match(dashboard, /<RecruiterWorkflowGuide compact \/>/)
  assert.match(project, /<RecruiterWorkflowGuide compact \/>/)
  assert.match(pipeline, /<RecruiterWorkflowGuide compact \/>/)
})

test("contributor-wide and Project-specific fields use distinct language", async () => {
  const [results, profile, projectOutreach, ownership] = await Promise.all([
    source("components/recent-scrapes.tsx"),
    source("app/contributors/[id]/page.tsx"),
    source("components/project-outreach.tsx"),
    source("docs/recruiter-workflow.md"),
  ])

  assert.match(results, /Contributor contact record/)
  assert.match(results, /Contributor notes \(optional\)/)
  assert.match(profile, /<CardTitle>Contributor notes<\/CardTitle>/)
  assert.match(profile, /<CardTitle>Contributor reminder<\/CardTitle>/)
  assert.match(projectOutreach, /<Label>Project outreach status<\/Label>/)
  assert.match(projectOutreach, /<Label>Project outreach notes<\/Label>/)
  assert.match(projectOutreach, /<Label>Project next follow-up<\/Label>/)
  assert.match(ownership, /Existing contributor-wide records remain supported for compatibility/)
})
