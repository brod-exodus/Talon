import test from "node:test"
import assert from "node:assert/strict"
import { roleHasPermission, sessionHasPermission, type AuthRole, type AuthSession, type Permission } from "../lib/permission-rules.ts"

const permissions: Permission[] = ["read", "write", "admin", "manage_members"]

test("roleHasPermission keeps viewer read-only", () => {
  const matrix: Record<AuthRole, Permission[]> = {
    owner: ["read", "write", "admin", "manage_members"],
    admin: ["read", "write", "admin"],
    recruiter: ["read", "write"],
    viewer: ["read"],
  }

  for (const [role, allowed] of Object.entries(matrix) as Array<[AuthRole, Permission[]]>) {
    for (const permission of permissions) {
      assert.equal(roleHasPermission(role, permission), allowed.includes(permission), `${role}:${permission}`)
    }
  }
})

test("sessionHasPermission gives break-glass admin full access", () => {
  const session: AuthSession = { version: 1, actor: "admin", expiresAt: 9999999999 }

  assert.equal(sessionHasPermission(session, "read"), true)
  assert.equal(sessionHasPermission(session, "write"), true)
  assert.equal(sessionHasPermission(session, "admin"), true)
  assert.equal(sessionHasPermission(session, "manage_members"), true)
})

test("sessionHasPermission denies anonymous requests", () => {
  assert.equal(sessionHasPermission(null, "read"), false)
  assert.equal(sessionHasPermission(null, "write"), false)
  assert.equal(sessionHasPermission(null, "admin"), false)
  assert.equal(sessionHasPermission(null, "manage_members"), false)
})
