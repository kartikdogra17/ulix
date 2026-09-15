/* ────────────────────────────────────────────────────────────────
   Chart primitives as inline SVG.

   These replaced a charting library that shipped 370 kB to draw one
   bar chart whose axis labels were illegible at the sizes this app
   actually uses. Everything here is a few hundred bytes, reads the
   theme through CSS variables so it flips with light/dark, and is
   sized for the tile it sits in rather than fighting a responsive
   container.
   ──────────────────────────────────────────────────────────────── */

import { useId } from 'react'
import { cn } from '../lib/cn'

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'muted'

const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--c-ok)', warn: 'var(--c-warn)', bad: 'var(--c-bad)',
  info: 'var(--c-accent)', brand: 'var(--c-brand)', muted: 'var(--c-faint)',
}

/* ── Sparkline ────────────────────────────────────────────────── */

export function Sparkline({
  values, tone = 'brand', className, height = 28, fill = true,
}: {
  values: number[]; tone?: Tone; className?: string; height?: number; fill?: boolean
}) {
  const id = useId()
  if (values.length < 2) return <div className={className} style={{ height }} />

  const W = 100, H = height
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pt = (v: number, i: number) => [
    (i / (values.length - 1)) * W,
    H - 2 - ((v - min) / span) * (H - 4),
  ] as const

  const pts = values.map(pt)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const [lastX, lastY] = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('w-full', className)} style={{ height }}
      preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONE_VAR[tone]} stopOpacity="0.28" />
          <stop offset="100%" stopColor={TONE_VAR[tone]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#sp${id})`} />}
      <path d={line} fill="none" stroke={TONE_VAR[tone]} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2" fill={TONE_VAR[tone]} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ── Radial gauge ─────────────────────────────────────────────── */

export function Radial({
  value, tone = 'brand', size = 56, label, sublabel, thickness = 5,
}: {
  value: number; tone?: Tone; size?: number; label?: string; sublabel?: string; thickness?: number
}) {
  const pct = Math.max(0, Math.min(100, value))
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--c-surface-3)" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={TONE_VAR[tone]} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="tnum text-[12px] font-semibold">{label ?? `${Math.round(pct)}%`}</span>
        {sublabel && <span className="mt-0.5 text-[8px] uppercase tracking-wide text-faint">{sublabel}</span>}
      </div>
    </div>
  )
}

/* ── Donut with segments ──────────────────────────────────────── */

export function Donut({
  segments, size = 92, thickness = 12, centre, centreSub,
}: {
  segments: Array<{ label: string; value: number; tone: Tone }>
  size?: number; thickness?: number; centre?: string; centreSub?: string
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--c-surface-3)" strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={TONE_VAR[s.tone]} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          )
          offset += len
          return el
        })}
      </svg>
      {centre && (
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="tnum text-[15px] font-semibold tracking-tight">{centre}</span>
          {centreSub && <span className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">{centreSub}</span>}
        </div>
      )}
    </div>
  )
}

/* ── Horizontal comparison bars ───────────────────────────────── */

export function CompareBars({
  rows, format = (n) => String(Math.round(n)), className,
}: {
  rows: Array<{ label: string; value: number; tone: Tone; hint?: string; dim?: boolean }>
  format?: (n: number) => string
  className?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className={cn('space-y-2', className)}>
      {rows.map((r) => (
        <div key={r.label} className={cn('flex items-center gap-2.5', r.dim && 'opacity-45')}>
          <span className="w-12 shrink-0 text-[11px] font-medium">{r.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-[3px] bg-surface-3">
            <div className="h-full rounded-[3px] transition-[width] duration-500"
              style={{ width: `${(r.value / max) * 100}%`, background: TONE_VAR[r.tone] }} />
          </div>
          <span className="tnum w-16 shrink-0 text-right text-[11px] font-medium">{format(r.value)}</span>
          {r.hint && <span className="hidden w-24 shrink-0 truncate text-[10px] text-faint sm:block">{r.hint}</span>}
        </div>
      ))}
    </div>
  )
}

/* ── Time-of-day band, for no-entry windows ───────────────────── */

export function DayBand({
  windows, markerMin, className,
}: {
  windows: Array<{ fromMin: number; toMin: number; label: string }>
  /** Projected arrival, drawn as a needle across the 24h band. */
  markerMin?: number
  className?: string
}) {
  const pct = (m: number) => (m / 1440) * 100
  return (
    <div className={cn('select-none', className)}>
      <div className="relative h-7 overflow-hidden rounded-md border border-line bg-ok-soft">
        {windows.map((w, i) => {
          // A window spanning midnight draws as two blocks.
          const parts = w.fromMin <= w.toMin
            ? [[w.fromMin, w.toMin]]
            : [[w.fromMin, 1440], [0, w.toMin]]
          return parts.map(([a, b], j) => (
            <div key={`${i}-${j}`} title={w.label}
              className="absolute inset-y-0 bg-bad/28"
              style={{ left: `${pct(a)}%`, width: `${pct(b - a)}%` }} />
          ))
        })}
        {[6, 12, 18].map((h) => (
          <div key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${pct(h * 60)}%` }} />
        ))}
        {markerMin !== undefined && (
          <div className="absolute inset-y-0 z-10 w-0.5 bg-fg" style={{ left: `${pct(markerMin)}%` }}>
            <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-fg" />
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-faint">
        {['00', '06', '12', '18', '24'].map((h) => <span key={h}>{h}:00</span>)}
      </div>
    </div>
  )
}
