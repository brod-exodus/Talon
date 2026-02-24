import { Header } from "@/components/header"
import { ScrapeForm } from "@/components/scrape-form"
import { ActiveScrapes } from "@/components/active-scrapes"
import { RecentScrapes } from "@/components/recent-scrapes"
import { WatchedRepos } from "@/components/watched-repos"

export default function Home() {
  return (
    <div className="min-h-screen bg-background relative">
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left sidebar - Scrape Form + Watched Repos */}
          <div className="lg:col-span-1 space-y-4 sm:space-y-6">
            <ScrapeForm />
            <WatchedRepos />
          </div>

          {/* Main content area */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <ActiveScrapes />
            <RecentScrapes />
          </div>
        </div>
      </main>
    </div>
  )
}
