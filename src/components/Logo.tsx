/* ────────────────────────────────────────────────────────────────
   ULIX — the control tower.

   A coined name, so the mark carries the meaning rather than the word:
   three streams entering from the left, meeting at a node, leaving as
   one heavier trunk. What comes out is more than what went in, which is
   the product — 95 endpoints across 36 government systems resolved into
   a single picture.

   Curved rather than angular so it reads as flow rather than as a
   network diagram, and built from four strokes so it survives 16 px in
   a browser tab.

   ULIX is independent software built on the Unified Logistics Interface
   Platform. It is not a government service and the UI says so where a
   user could reasonably wonder — the login page and the settings screen.
   ──────────────────────────────────────────────────────────────── */

import { cn } from '../lib/cn'

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? 'img' : 'presentation'}
      aria-label={title}>
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M3.5 7.5C9 7.5 11 14 15.5 15.7" strokeWidth="2" />
        <path d="M3.5 24.5C9 24.5 11 18 15.5 16.3" strokeWidth="2" />
        <path d="M3.5 16h11" strokeWidth="2" />
        {/* The trunk is heavier: what leaves is more than what entered. */}
        <path d="M16.5 16H28.5" strokeWidth="3.2" />
      </g>
      <circle cx="15.8" cy="16" r="2.9" fill="currentColor" />
    </svg>
  )
}

/** Mark in a tinted tile — the app-icon treatment used in headers. */
export function LogoTile({ className }: { className?: string }) {
  return (
    <span className={cn(
      'grid shrink-0 place-items-center rounded-xl bg-brand text-brand-fg',
      className ?? 'size-9',
    )}>
      <LogoMark className="size-[64%]" />
    </span>
  )
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="leading-tight">
      {/* Four letters, set tight and upper-case. The X takes the brand colour
          so the wordmark still reads as a mark when the tile is not beside it. */}
      <span className="block text-[16px] font-semibold uppercase tracking-[0.06em]">
        ULI<span className="text-brand">X</span>
      </span>
      {!compact && (
        <span className="block text-[9px] uppercase tracking-[0.15em] text-faint">
          Logistics Control Tower
        </span>
      )}
    </span>
  )
}

export function Logo({ compact, tileClass }: { compact?: boolean; tileClass?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoTile className={tileClass} />
      <Wordmark compact={compact} />
    </span>
  )
}
