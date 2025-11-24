"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"

export function Header() {
  const pathname = usePathname()

  return (
    <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4 max-w-7xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              <div className="relative">
                <Image
                  src="/logos/option-d-abstract.jpg"
                  alt="Talent Intelligence Logo"
                  width={40}
                  height={40}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Talent Intelligence
              </h1>
              <p className="text-xs text-muted-foreground">GitHub Contributor Discovery</p>
            </div>
          </Link>

          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Home
            </Link>
            <Link
              href="/settings"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/settings"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              Settings
            </Link>
          </nav>
        </div>
      </div>
    </header>
  )
}
