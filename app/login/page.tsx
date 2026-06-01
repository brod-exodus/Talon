"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import Image from "next/image"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<"signin" | "signup">("signin")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError("")

    try {
      const response = await fetch(mode === "signin" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error ?? "Unable to sign in")
        return
      }

      router.push("/")
      router.refresh()
    } catch {
      setError("Unable to sign in")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader>
          <div className="mb-2 flex flex-col items-start gap-2">
            <Image
              src="/talon-header-logo.png"
              alt="Talon"
              width={190}
              height={59}
              priority
              unoptimized
              className="h-12 w-auto object-contain"
            />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Team access</p>
          </div>
          <CardDescription>
            {mode === "signin"
              ? "Sign in with your team email and password."
              : "Create your private Talon workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  placeholder="Brody"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="recruiter@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button className="w-full" type="submit" disabled={loading}>
              {loading
                ? mode === "signin"
                  ? "Signing in..."
                  : "Creating workspace..."
                : mode === "signin"
                  ? "Sign In"
                  : "Create Workspace"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs"
              onClick={() => {
                setError("")
                setMode((current) => (current === "signin" ? "signup" : "signin"))
              }}
            >
              {mode === "signin" ? "Create a private workspace" : "Already have an account? Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
