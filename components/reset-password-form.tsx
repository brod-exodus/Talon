"use client"

import type React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TalonLogo } from "@/components/talon-logo"

export function ResetPasswordForm({ tokenHash, validType }: { tokenHash: string; validType: boolean }) {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState("")
  const [complete, setComplete] = useState(false)
  const [loading, setLoading] = useState(false)
  const hasLink = validType && tokenHash.length > 0

  useEffect(() => {
    if (hasLink) window.history.replaceState({}, document.title, "/reset-password")
  }, [hasLink])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (password !== confirmation) {
      setError("New passwords do not match.")
      return
    }
    if (password.trim().length < 8 || password.trim().length > 128) {
      setError("Password must be 8 to 128 characters.")
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash, password }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? "Unable to reset password")
        return
      }
      setComplete(true)
    } catch {
      setError("Unable to reset password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="talon-grid-bg relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader>
          <div className="mb-2 flex flex-col items-start gap-3">
            <TalonLogo markClassName="h-11 w-11" wordmarkClassName="text-[1.6rem]" />
          </div>
          <CardDescription>Choose a new password for your Talon account.</CardDescription>
        </CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-4">
              <Alert><AlertDescription>Your password was updated. All previous Talon sessions were signed out.</AlertDescription></Alert>
              <Button asChild className="w-full"><Link href="/login">Return to Sign In</Link></Button>
            </div>
          ) : !hasLink ? (
            <div className="space-y-4">
              <Alert variant="destructive"><AlertDescription>This password reset link is invalid or incomplete.</AlertDescription></Alert>
              <Button asChild className="w-full"><Link href="/login">Request a New Link</Link></Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <Button className="w-full" type="submit" disabled={loading}>{loading ? "Updating..." : "Update Password"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
