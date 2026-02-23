"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Mail } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"

export function EmailCopyButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(email)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <TooltipProvider>
      <Tooltip open={copied ? true : undefined}>
        <TooltipTrigger asChild>
          <motion.button
            whileHover={{ x: 4 }}
            onClick={handleCopy}
            className="flex items-center gap-2 text-sm cursor-pointer group w-full text-left"
          >
            <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
            <span className="text-primary font-mono break-all group-hover:underline transition-colors">
              {email}
            </span>
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          <p>{copied ? "✓ Copied" : "Copy"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
