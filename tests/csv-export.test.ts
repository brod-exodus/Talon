import test from "node:test"
import assert from "node:assert/strict"
import { buildCsvContent, buildPublicCsvContent, hasExportableContact } from "../lib/csv-export.ts"

test("CSV export sorts contributors and escapes spreadsheet-sensitive text", () => {
  const csv = buildCsvContent([
    {
      username: "second",
      name: "Second Person",
      contributions: 2,
      contacts: { website: "https://second.example" },
    },
    {
      username: "first",
      name: 'First, "Quoted" Person',
      contributions: 10,
      contacts: { email: "first@example.com", twitter: "first_user" },
      contacted: true,
      notes: "Line one\nLine two",
      status: "replied",
    },
  ])

  const lines = csv.split("\n")
  assert.equal(lines[0], "#,Name,Username,GitHub Profile,Contributions,Email,Twitter,LinkedIn,Website,Contacted,Contact Date,Notes,Status")
  assert.match(csv, /"First, ""Quoted"" Person"/)
  assert.match(csv, /https:\/\/twitter\.com\/first_user/)
  assert.ok(csv.indexOf("first,https://github.com/first,10") < csv.indexOf("second,https://github.com/second,2"))
  assert.match(csv, /"Line one\nLine two"/)
})

test("contactable export detection ignores empty contact values", () => {
  assert.equal(hasExportableContact({ username: "none", name: "None", contributions: 1, contacts: {} }), false)
  assert.equal(
    hasExportableContact({
      username: "email",
      name: "Email",
      contributions: 1,
      contacts: { email: " person@example.com " },
    }),
    true
  )
})

test("public CSV excludes outreach and recruiter-only columns", () => {
  const csv = buildPublicCsvContent([{
    username: "octocat",
    name: "The Octocat",
    contributions: 10,
    contacts: { email: "public@example.com" },
    contacted: true,
    notes: "private note",
    status: "interviewing",
  }])

  assert.match(csv, /^#,Name,Username,GitHub Profile,Contributions,Email,Twitter,LinkedIn,Website/m)
  assert.doesNotMatch(csv, /Contacted|Contact Date|Notes|Status|private note|interviewing/)
})
