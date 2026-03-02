"use client"

import { useState } from "react"

export function CopyableEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <a
      href={`mailto:${email}`}
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-primary hover:underline font-mono"
    >
      <svg
        className="w-4 h-4 shrink-0 text-muted-foreground"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
        />
      </svg>
      {copied ? (
        <span className="text-green-500">Copied!</span>
      ) : (
        email
      )}
    </a>
  )
}
