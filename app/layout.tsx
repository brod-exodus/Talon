import type React from "react"
import type { Metadata } from "next"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Talon",
  description: "Discover, monitor, and organize GitHub contributors across recruiting projects.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen flex flex-col">
        <Suspense fallback={null}>
          <div className="flex-1">{children}</div>
        </Suspense>
        <footer className="relative z-10 border-t border-white/60 bg-white/55 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} Talon</span>
            <span>Developed by Brodan White</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
