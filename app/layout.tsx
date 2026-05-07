import type React from "react"
import type { Metadata } from "next"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Talon",
  description: "Discover, monitor, and organize GitHub contributors across repositories and ecosystems.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased min-h-screen flex flex-col">
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
