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
  icons: {
    icon: "/logos/option-d-abstract.jpg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  )
}
