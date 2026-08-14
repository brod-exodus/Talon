import assert from "node:assert/strict"
import test from "node:test"
import { contributorMatchesLocation } from "../lib/contributor-location-search.ts"

test("empty location searches leave the completed list unfiltered", () => {
  assert.equal(contributorMatchesLocation(undefined, ""), true)
  assert.equal(contributorMatchesLocation("Berlin, Germany", "   "), true)
})

test("location search is case-insensitive and tolerates punctuation", () => {
  assert.equal(contributorMatchesLocation("São Paulo, Brazil", "sao paulo"), true)
  assert.equal(contributorMatchesLocation("London, UK", "LONDON"), true)
  assert.equal(contributorMatchesLocation("Toronto, Canada", "London"), false)
})

test("NYC and New York searches match common self-reported city variants", () => {
  for (const location of [
    "NYC",
    "New York, NY",
    "New York City",
    "Brooklyn, NY",
    "Queens, New York",
    "The Bronx",
    "Staten Island",
    "Manhattan",
  ]) {
    assert.equal(contributorMatchesLocation(location, "NYC"), true, location)
    assert.equal(contributorMatchesLocation(location, "New York"), true, location)
  }
})

test("NYC aliases do not infer a location from missing or unrelated profile text", () => {
  assert.equal(contributorMatchesLocation(null, "NYC"), false)
  assert.equal(contributorMatchesLocation("Anywhere but here", "NYC"), false)
  assert.equal(contributorMatchesLocation("Queensland, Australia", "NYC"), false)
  assert.equal(contributorMatchesLocation("Jersey City, NJ", "New York"), false)
})
