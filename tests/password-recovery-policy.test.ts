import assert from "node:assert/strict"
import test from "node:test"
import { isPasswordRecoveryEnabled } from "../lib/password-recovery-policy.ts"

test("password recovery is disabled when the setting is absent", () => {
  assert.equal(isPasswordRecoveryEnabled(undefined), false)
})

test("password recovery requires an explicit true setting", () => {
  for (const value of ["", "false", "1", "yes", "enabled", " true-ish "]) {
    assert.equal(isPasswordRecoveryEnabled(value), false, value)
  }

  assert.equal(isPasswordRecoveryEnabled("true"), true)
  assert.equal(isPasswordRecoveryEnabled(" TRUE "), true)
})
