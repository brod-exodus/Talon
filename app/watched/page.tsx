import { Header } from "@/components/header"
import { WatchedRepos } from "@/components/watched-repos"

export default function WatchedPage() {
  return (
    <div className="prism-app">
      <Header />

      <main className="prism-main-narrow">
        <div className="mb-8">
          <p className="prism-section-title">Automation</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Watched repositories</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
            Monitor selected repositories and send Slack alerts when new contributors appear.
          </p>
        </div>
        <div className="max-w-3xl">
          <WatchedRepos />
        </div>
      </main>
    </div>
  )
}
