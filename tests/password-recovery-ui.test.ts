import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const loginForm = readFileSync(resolve(import.meta.dirname, "../components/login-form.tsx"), "utf8")
const resetForm = readFileSync(resolve(import.meta.dirname, "../components/reset-password-form.tsx"), "utf8")
const resetPage = readFileSync(resolve(import.meta.dirname, "../app/reset-password/page.tsx"), "utf8")

test("login exposes recovery without opening self-service registration", () => {
  assert.match(loginForm, /Forgot password\?/)
  assert.match(loginForm, /\/api\/auth\/password\/reset-request/)
  assert.match(loginForm, /allowSelfServiceSignup && !resetMode/)
  assert.match(loginForm, /mode === "signin" && allowPasswordRecovery/)
})

test("the recovery token is removed from the address bar and never persisted", () => {
  const removeToken = resetForm.indexOf('window.history.replaceState({}, document.title, "/reset-password")')
  const submitToken = resetForm.indexOf('body: JSON.stringify({ tokenHash, password })')

  assert.ok(removeToken >= 0)
  assert.ok(submitToken > removeToken)
  assert.doesNotMatch(resetForm, /localStorage|sessionStorage|document\.cookie/)
  assert.match(resetPage, /dynamic = "force-dynamic"/)
  assert.match(resetPage, /revalidate = 0/)
})
