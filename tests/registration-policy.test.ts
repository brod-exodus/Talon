import assert from "node:assert/strict"
import test from "node:test"
import { isSelfServiceSignupEnabled } from "../lib/registration-policy.ts"

test("self-service registration is closed when the setting is absent", () => {
  assert.equal(isSelfServiceSignupEnabled(undefined), false)
})

test("self-service registration requires an explicit true setting", () => {
  for (const value of ["", "false", "1", "yes", "enabled", " true-ish "]) {
    assert.equal(isSelfServiceSignupEnabled(value), false, value)
  }

  assert.equal(isSelfServiceSignupEnabled("true"), true)
  assert.equal(isSelfServiceSignupEnabled(" TRUE "), true)
})
