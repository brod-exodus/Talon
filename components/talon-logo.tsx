import { cn } from "@/lib/utils"

// Talon brand mark: a three-claw raptor strike, cyan on the dark "prism" surface.
// Standalone copies of this artwork live at public/talon-mark.svg and public/talon-logo.svg.
const CLAW_PATHS = [
  "M123 175L124 182L125 190L125 198L126 206L126 215L126 223L126 231L126 240L125 248L125 257L124 265L123 274L122 282L120 290L119 298L117 307L115 314L112 322L110 330L107 337L104 345L101 352L97 358L93 365L89 372L84 378L79 384L74 390L74 390L81 387L88 383L95 378L102 373L108 367L113 361L119 354L124 347L129 340L134 332L138 324L143 316L146 308L150 299L153 291L157 282L159 273L162 264L165 255L167 246L169 236L170 227L172 218L173 209L175 200L176 191L176 182L177 173A27 27 0 1 0 123 175Z",
  "M231 110L233 121L234 133L235 146L236 159L236 172L237 185L237 199L237 212L237 226L236 240L235 253L234 267L233 281L231 294L229 307L226 320L224 333L221 345L217 357L213 368L209 379L204 390L199 400L193 409L187 418L181 426L174 434L166 442L166 442L176 438L186 433L195 426L204 418L213 409L221 400L228 390L235 379L242 367L248 355L253 343L259 330L263 316L268 302L272 289L276 274L279 260L282 246L285 231L287 217L289 202L291 188L293 174L294 160L295 146L296 132L297 119L297 106A33 33 0 1 0 231 110Z",
  "M349 176L350 184L352 193L352 201L353 210L354 219L354 228L354 238L354 247L354 256L353 265L353 275L352 284L350 293L349 302L347 311L344 320L342 329L339 338L336 346L332 355L328 363L324 371L319 378L314 386L308 393L302 400L295 407L288 414L288 414L297 410L306 405L314 400L322 394L329 387L336 380L343 373L349 365L355 357L360 348L365 339L370 330L374 321L378 311L382 301L385 292L388 282L391 272L393 261L395 251L397 241L399 231L400 221L401 211L402 201L402 191L403 182L403 172A27 27 0 1 0 349 176Z",
]

export function TalonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="43 75 370 370" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="talon-claw-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7df0ff" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      {CLAW_PATHS.map((d) => (
        <path key={d.slice(0, 16)} fill="url(#talon-claw-gradient)" d={d} />
      ))}
    </svg>
  )
}

export function TalonLogo({
  className,
  markClassName,
  wordmarkClassName,
  tagline = false,
}: {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
  tagline?: boolean
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <TalonMark className={cn("h-9 w-9 shrink-0", markClassName)} />
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={cn(
            "text-[1.4rem] font-extrabold leading-none tracking-[0.04em] text-foreground",
            wordmarkClassName
          )}
        >
          TALON
        </span>
        {tagline && (
          <span className="mt-1.5 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.3em] text-primary">
            Talent Intelligence
          </span>
        )}
      </span>
    </span>
  )
}
