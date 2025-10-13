import { Header } from "@/components/header"
import { ScrapeForm } from "@/components/scrape-form"
import { ActiveScrapes } from "@/components/active-scrapes"
import { RecentScrapes } from "@/components/recent-scrapes"

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-6 py-12 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left sidebar - Scrape Form */}
          <div className="lg:col-span-1">
            <ScrapeForm />
          </div>

          {/* Main content area */}
          <div className="lg:col-span-2 space-y-8">
            <ActiveScrapes />
            <RecentScrapes />
          </div>
        </div>
      </main>
    </div>
  )
}
