"use client"

import type React from "react"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings, AlertCircle } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { getStoredGithubToken } from "@/lib/client-secrets"


// ─── Starfield Canvas ─────────────────────────────────────────────────────────

function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // ── Size canvas to its parent ───────────────────────────────────────────
    const setSize = () => {
      const p = canvas.parentElement
      if (!p) return
      canvas.width  = p.offsetWidth
      canvas.height = p.offsetHeight
    }
    setSize()

    // ── Star type ───────────────────────────────────────────────────────────
    type Star = {
      angle:  number   // current polar angle (radians)
      radius: number   // distance from canvas center (px)
      speed:  number   // radians per frame
      size:   number   // dot radius (px)
      index:  number   // stable index for flicker formula
    }

    // ── Shooting star type ──────────────────────────────────────────────────
    type Shooter = {
      x:  number
      y:  number
      vx: number
      vy: number
    }

    // ── Build 360 polar stars distributed across the full canvas diagonal ──
    const initStars = (): Star[] =>
      Array.from({ length: 80 }, (_, i) => ({
        angle:  Math.random() * Math.PI * 2,
        // radius spread well beyond the card so stars are spaced across a wide area
        radius: Math.random() * Math.hypot(canvas.width, canvas.height) * 1.1,
        speed:  0.00015 + Math.random() * 0.00030,
        size:   0.5  + Math.random() * 1.2,
        index:  i,
      }))

    let stars: Star[] = initStars()

    // ── Shooting stars (at most one at a time per spec) ─────────────────────
    let shooter: Shooter | null = null

    const spawnShooter = (): Shooter => ({
      x:  Math.random() * canvas.width,
      y:  0,
      vx: 2   + Math.random() * 1.5,
      vy: 0.8 + Math.random() * 1,
    })

    // ── Render loop ─────────────────────────────────────────────────────────
    let rafId: number

    const tick = () => {
      const w  = canvas.width
      const h  = canvas.height
      const cx = w / 2
      const cy = h / 2
      const now = Date.now()

      ctx.clearRect(0, 0, w, h)

      // — rotating polar stars —
      for (const s of stars) {
        s.angle += s.speed

        const x  = cx + s.radius * Math.cos(s.angle)
        const y  = cy + s.radius * Math.sin(s.angle)
        const op = 0.2 + Math.abs(Math.sin(now * 0.0015 + s.index)) * 0.3

        ctx.beginPath()
        ctx.arc(x, y, s.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${op.toFixed(3)})`
        ctx.fill()
      }

      // — maybe spawn a shooter —
      if (!shooter && Math.random() < 0.0008) {
        shooter = spawnShooter()
      }

      // — draw & advance shooter —
      if (shooter) {
        const tailX = shooter.x - shooter.vx * 35 / Math.hypot(shooter.vx, shooter.vy)
        const tailY = shooter.y - shooter.vy * 35 / Math.hypot(shooter.vx, shooter.vy)

        const grad = ctx.createLinearGradient(shooter.x, shooter.y, tailX, tailY)
        grad.addColorStop(0, "rgba(255,255,255,0.8)")
        grad.addColorStop(1, "rgba(255,255,255,0)")

        ctx.beginPath()
        ctx.moveTo(shooter.x, shooter.y)
        ctx.lineTo(tailX, tailY)
        ctx.strokeStyle = grad
        ctx.lineWidth   = 1.5
        ctx.lineCap     = "round"
        ctx.stroke()

        // Head dot
        ctx.beginPath()
        ctx.arc(shooter.x, shooter.y, 1, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        ctx.fill()

        shooter.x += shooter.vx
        shooter.y += shooter.vy

        // Remove once fully off-canvas
        if (shooter.x > w + 40 || shooter.y > h + 40) {
          shooter = null
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    // ── Reinitialize stars on resize ────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      setSize()
      stars = initStars()
    })
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ borderRadius: "inherit" }}
    />
  )
}

// ─── Galaxy Glass Card ────────────────────────────────────────────────────────

interface GalaxyCardProps {
  children: React.ReactNode
  className?: string
}

function GalaxyGlassCard({ children, className }: GalaxyCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10 p-6 shadow-2xl",
        className
      )}
      style={{ background: "#0F172A" }}
    >
      {/* Canvas starfield — 250 tiny pinpoint stars, nearly imperceptible drift */}
      <StarfieldCanvas />

      {/* Content — above the canvas */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}

export function ScrapeForm() {
  const [type, setType] = useState("organization")
  const [target, setTarget] = useState("")
  const [minContributions, setMinContributions] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [existingTargets, setExistingTargets] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    fetch("/api/scrapes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const completed = data.completed || []
        setExistingTargets(new Set(completed.map((s: { type: string; target: string }) => `${s.type}:${s.target}`)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isDuplicate = useMemo(() => {
    if (!target) return false
    return existingTargets.has(`${type}:${target}`)
  }, [target, type, existingTargets])

  const typeMismatch = useMemo<"looks-like-repo" | "looks-like-org" | null>(() => {
    if (!target.trim()) return null
    if (type === "organization" && target.includes("/")) return "looks-like-repo"
    if (type === "repository" && !target.includes("/")) return "looks-like-org"
    return null
  }, [target, type])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      const { token } = getStoredGithubToken()

      if (!token) {
        toast({
          title: "GitHub token required",
          description: "Please add your GitHub token in Settings first",
          variant: "destructive",
        })
        return
      }

      setIsLoading(true)

      try {
        const response = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, target: target.trim(), token, minContributions }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to start scrape")
        }

        const data = await response.json()

        const rateLimitMsg = data.rateLimit ? ` Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : ""
        toast({
          title: "Scrape queued",
          description: `Queued ${target} for processing.${rateLimitMsg}`,
        })

        setTarget("")
      } catch (error) {
        console.error("[v0] Scrape error:", error)
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to start scrape",
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    },
    [type, target, minContributions, toast],
  )

  const getPlaceholder = () => {
    switch (type) {
      case "organization":
        return "e.g. vercel"
      case "repository":
        return "owner/repo"
      default:
        return ""
    }
  }

  const getLabel = () => {
    switch (type) {
      case "organization":
        return "Owner/Organization"
      case "repository":
        return "Repository"
      default:
        return "Target"
    }
  }

  return (
    <GalaxyGlassCard className="sticky top-24">
      {/* Header */}
      <div className="mb-5">
        <h3 className="text-lg font-bold text-white">New Scrape</h3>
        <p className="text-xs text-slate-400 mt-0.5">Discover contributors with contact information</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="type" className="text-sm font-medium text-slate-400">
            Source Type
          </Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger
              id="type"
              className="bg-slate-950/60 border-white/5 text-white focus:border-blue-500/50 transition-colors"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Organization</SelectItem>
              <SelectItem value="repository">Repository</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target" className="text-sm font-medium text-slate-400">
            {getLabel()}
          </Label>
          <Input
            id="target"
            placeholder={getPlaceholder()}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-slate-950/60 border-white/5 text-white placeholder:text-slate-600 focus:border-blue-500/50 transition-colors"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="minContributions" className="text-sm font-medium text-slate-400">
            Minimum Contributions
          </Label>
          <Input
            id="minContributions"
            type="number"
            min={1}
            value={minContributions}
            onChange={(e) => setMinContributions(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="bg-slate-950/60 border-white/5 text-white placeholder:text-slate-600 focus:border-blue-500/50 transition-colors"
          />
          <p className="text-xs text-slate-500">
            Only include contributors with at least this many contributions
          </p>
        </div>

        {typeMismatch === "looks-like-repo" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like a repository (owner/repo). You must select <strong>Repository</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-6 px-2 text-xs border-blue-500/40 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition-colors"
                onClick={() => setType("repository")}
              >
                Switch to Repository
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {typeMismatch === "looks-like-org" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like an organization name. You must select <strong>Organization</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-6 px-2 text-xs border-blue-500/40 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition-colors"
                onClick={() => setType("organization")}
              >
                Switch to Organization
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isDuplicate && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <AlertDescription className="text-xs text-yellow-500">
              You have already scraped this {type}. Scraping again will create a duplicate.
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full font-semibold relative overflow-hidden group transition-all duration-200"
          style={{
            backgroundColor: "#3B82F6",
            color: "#ffffff",
            boxShadow: "0 0 15px rgba(59, 130, 246, 0.4)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 0 25px rgba(59, 130, 246, 0.65)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 0 15px rgba(59, 130, 246, 0.4)"
          }}
          disabled={!target || isLoading}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
          {isLoading ? "Starting..." : "Start Scrape"}
        </Button>

        <Link href="/settings" className="block">
          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs text-slate-400 hover:text-white bg-transparent hover:bg-white/5"
            size="sm"
          >
            <Settings className="w-3 h-3 mr-2" />
            Configure GitHub Token
          </Button>
        </Link>
      </form>
    </GalaxyGlassCard>
  )
}
