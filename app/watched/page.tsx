import { Header } from "@/components/header"
import { WatchedRepos } from "@/components/watched-repos"

export default function WatchedPage() {
  return (
    <div className="min-h-screen bg-background relative">
      <Header />

      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl relative z-10">
        <div className="max-w-2xl">
          <WatchedRepos />
        </div>
      </main>
    </div>
  )
}
