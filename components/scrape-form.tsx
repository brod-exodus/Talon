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


// ─── Starfield Canvas ─────────────────────────────────────────────────────────

// Color distribution: 70% white, 20% pale blue #BAE6FD, 10% pale purple #E9D5FF
const STAR_COLORS = [
  { r: 255, g: 255, b: 255 }, // white ×7
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
  { r: 186, g: 230, b: 253 }, // #BAE6FD pale blue ×2
  { r: 186, g: 230, b: 253 },
  { r: 233, g: 213, b: 255 }, // #E9D5FF pale purple ×1
]

function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Size canvas to its parent card
    const setSize = () => {
      const p = canvas.parentElement
      if (!p) return
      canvas.width = p.offsetWidth
      canvas.height = p.offsetHeight
    }
    setSize()

    // Star state
    type Star = {
      x: number; y: number; size: number
      r: number; g: number; b: number
      baseOpacity: number; phase: number
      twinkleSpeed: number; vy: number; vx: number
    }

    const mkStar = (w: number, h: number, index: number): Star => {
      const c = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]

      // Three distinct size tiers based on index bucket:
      //   60% small  (0.4 px, max opacity 0.50)
      //   30% medium (0.8 px, max opacity 0.65)
      //   10% large  (1.2 px, max opacity 0.80)
      const tier = index < 240 ? "s" : index < 360 ? "m" : "l"
      const size        = tier === "s" ? 0.4 : tier === "m" ? 0.8 : 1.2
      const maxOpacity  = tier === "s" ? 0.50 : tier === "m" ? 0.65 : 0.80
      const minOpacity  = maxOpacity * 0.35          // floor at ~35% of max so they never vanish

      return {
        x: Math.random() * w,
        y: Math.random() * h,
        size,
        ...c,
        baseOpacity: minOpacity + Math.random() * (maxOpacity - minOpacity),
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.003 + Math.random() * 0.010,
        vy: Math.random() * 0.05,                   // 0 – 0.05 px/frame — nearly still
        vx: (Math.random() - 0.5) * 0.02,
      }
    }

    let stars: Star[] = Array.from({ length: 400 }, (_, i) =>
      mkStar(canvas.width, canvas.height, i)
    )

    let rafId: number

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const s of stars) {
        // Drift
        s.y += s.vy
        s.x += s.vx
        // Wrap
        if (s.y > canvas.height + 2) { s.y = -2; s.x = Math.random() * canvas.width }
        if (s.x < -2)                  s.x = canvas.width + 2
        if (s.x > canvas.width + 2)    s.x = -2

        // Twinkle — sine-wave opacity, fully independent per star
        s.phase += s.twinkleSpeed
        const opacity = s.baseOpacity * (0.3 + 0.7 * (Math.sin(s.phase) * 0.5 + 0.5))

        // Core dot
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${opacity.toFixed(3)})`
        ctx.fill()

        // No glow — stars are all sub-1px pinpoints; glow would make them look large
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    // Re-size and rebuild stars if the card resizes
    const ro = new ResizeObserver(() => {
      setSize()
      stars = Array.from({ length: 400 }, (_, i) =>
        mkStar(canvas.width, canvas.height, i)
      )
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

      const token = typeof window !== "undefined" ? localStorage.getItem("github_token") : null

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
          body: JSON.stringify({ type, target: target.trim(), token }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to start scrape")
        }

        const data = await response.json()

        fetch(`/api/scrape/${data.scrapeId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, target: target.trim(), token }),
        })

        const rateLimitMsg = data.rateLimit ? ` Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : ""
        toast({
          title: "Scrape started",
          description: `Processing ${target}...${rateLimitMsg}`,
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
    [type, target, toast],
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
              You've already scraped this {type}. Scraping again will create a duplicate.
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
