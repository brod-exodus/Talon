import type React from "react"
import type { Metadata } from "next"
import { Suspense } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Talon",
  description: "Discover, monitor, and organize GitHub contributors across recruiting projects.",
  icons: {
    icon: [
      { url: "/favicon/favicon.ico", sizes: "any" },
      { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    other: [
      { rel: "icon", url: "/favicon/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/favicon/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
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
        <footer className="relative z-10 border-t border-border bg-[#0a0e14]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-4 font-mono text-[11px] text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} Talon</span>
            <span>Developed by Brodan White</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
