/* ────────────────────────────────────────────────────────────────
   Sangam — the confluence, where many streams become one.

   The name is the product: 95 endpoints across 36 government systems
   resolving into a single picture. It is also deliberately NOT "ULIP",
   because this is software built on top of the government platform, not
   the platform itself, and a name that implied otherwise would be
   dishonest.

   The mark draws the same idea: three streams entering from the left,
   meeting at a node, leaving as one heavier trunk. Curved rather than
   angular so it reads as flow rather than as a network diagram, and
   built from four strokes so it survives 16 px in a browser tab.
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
      <span className="block text-[15px] font-semibold tracking-[-0.02em]">Sangam</span>
      {!compact && (
        <span className="block text-[9.5px] uppercase tracking-[0.14em] text-faint">
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
