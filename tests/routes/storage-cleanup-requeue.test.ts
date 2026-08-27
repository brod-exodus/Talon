import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mocks.from, rpc: vi.fn(), storage: { from: vi.fn() } },
}))
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), sanitizeOperationalError: vi.fn() }))

import { requeueFailedStorageCleanupTasks } from "@/lib/storage-cleanup-worker"

describe("failed storage cleanup recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-27T20:00:00.000Z"))
    mocks.from.mockReturnValue({ update: mocks.update })
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.eq.mockReturnValue({ select: mocks.select })
    mocks.select.mockResolvedValue({ data: [{ id: "task-1" }, { id: "task-2" }], error: null })
  })

  test("requeues only terminal tasks with a fresh bounded retry budget", async () => {
    await expect(requeueFailedStorageCleanupTasks()).resolves.toBe(2)

    expect(mocks.from).toHaveBeenCalledWith("storage_cleanup_tasks")
    expect(mocks.update).toHaveBeenCalledWith({
      status: "queued",
      attempts: 0,
      run_after: "2026-08-27T20:00:00.000Z",
      completed_at: null,
      updated_at: "2026-08-27T20:00:00.000Z",
    })
    expect(mocks.eq).toHaveBeenCalledWith("status", "failed")
    expect(mocks.select).toHaveBeenCalledWith("id")
  })

  test("fails closed when the requeue write is unavailable", async () => {
    mocks.select.mockResolvedValue({ data: null, error: new Error("private database detail") })
    await expect(requeueFailedStorageCleanupTasks()).rejects.toThrow("private database detail")
  })
})
