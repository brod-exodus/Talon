import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), logError: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } } }))
vi.mock("@/lib/logger", () => ({
  logError: mocks.logError,
  sanitizeOperationalError: (error: unknown) => ({ message: error instanceof Error ? "Storage cleanup failed" : "Unknown error" }),
}))
import { runStorageCleanupTask } from "@/lib/storage-cleanup-worker"

describe("durable storage cleanup worker", () => {
  beforeEach(() => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "recover_stale_storage_cleanup_tasks") return Promise.resolve({ data: 0, error: null })
      if (name === "claim_storage_cleanup_task") return Promise.resolve({ data: [{ id: "task-1", bucket: "team-avatars", object_paths: ["team/avatar.png"] }], error: null })
      if (name === "complete_storage_cleanup_task") return Promise.resolve({ data: true, error: null })
      if (name === "fail_storage_cleanup_task") return Promise.resolve({ data: "queued", error: null })
      throw new Error(name)
    })
    mocks.remove.mockResolvedValue({ error: null })
  })

  test("removes allowlisted objects and completes the active lease", async () => {
    await expect(runStorageCleanupTask("task-1")).resolves.toMatchObject({ taskId: "task-1", status: "succeeded" })
    expect(mocks.remove).toHaveBeenCalledWith(["team/avatar.png"])
    expect(mocks.rpc).toHaveBeenCalledWith("complete_storage_cleanup_task", expect.objectContaining({ p_task_id: "task-1" }))
  })

  test("persists a sanitized retry instead of losing failed cleanup", async () => {
    mocks.remove.mockResolvedValue({ error: new Error("private provider detail") })
    await expect(runStorageCleanupTask()).resolves.toMatchObject({ status: "queued" })
    expect(mocks.rpc).toHaveBeenCalledWith("fail_storage_cleanup_task", expect.objectContaining({ p_error: "Storage cleanup failed" }))
  })
})
