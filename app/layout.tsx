import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Suspense } from "react"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "GitHub Scraper v2",
  description: "Discover and track GitHub contributors across organizations and repositories",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased min-h-screen flex flex-col`}>
        <Suspense fallback={null}>
          <div className="flex-1">{children}</div>
        </Suspense>
        <footer className="border-t border-border bg-card/50 backdrop-blur-sm">
          <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} Talon</span>
            <span>Developed by Brodan White</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
