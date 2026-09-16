import { useMemo, useState } from 'react'
import { NODES, NODE_BY_CODE } from '../data/mock/seed'
import { cn } from '../lib/cn'
import type { Mode } from '../data/types'

/* Equirectangular projection over the Indian landmass bounding box.
   Nodes sit at their true coordinates — this is a network schematic,
   not a cartographic boundary rendering. */
const LON0 = 67, LON1 = 98, LAT0 = 6, LAT1 = 37
const W = 620, H = 620
export const px = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * W
export const py = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * H

export interface MapRoute { from: string; to: string; mode: Mode; active?: boolean }

/**
 * A fixed piece of infrastructure drawn under the traffic — a GatiShakti
 * corridor, given as its own coordinates rather than as node codes,
 * because a corridor passes through places this network has no node for.
 */
export interface MapCorridor {
  id: string
  mode: 'road' | 'rail'
  points: Array<{ lat: number; lon: number }>
  /** Segments below the corridor's own standard, drawn heavier. */
  pinches?: Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number }; label: string }>
  label?: string
}
export interface MapMarker {
  id: string; lat: number; lon: number
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'brand'
  label?: string; pulse?: boolean; r?: number
  /** Glyph instead of a dot — hazards and stops read better as shapes. */
  glyph?: 'dot' | 'hazard' | 'toll' | 'fuel' | 'ev' | 'park'
}

const TONE_VAR = {
  ok: 'var(--c-ok)', warn: 'var(--c-warn)', bad: 'var(--c-bad)',
  info: 'var(--c-accent)', brand: 'var(--c-brand)',
} as const

const MODE_DASH: Record<Mode, string> = {
  road: '', rail: '10 5', sea: '2 6', air: '16 8',
}

const MODE_STROKE: Record<Mode, string> = {
  road: 'var(--c-brand)', rail: 'var(--c-accent)',
  sea: 'var(--c-info)', air: 'var(--c-warn)',
}

/** Small glyphs drawn in map space, so they scale with the viewBox. */
function Glyph({ kind, x, y, colour }: {
  kind: NonNullable<MapMarker['glyph']>; x: number; y: number; colour: string
}) {
  if (kind === 'hazard') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <path d="M0 -5.4 L4.8 3.2 L-4.8 3.2 Z" fill={colour} stroke="var(--c-bg)" strokeWidth="1" />
        <rect x="-0.55" y="-2.6" width="1.1" height="3.4" rx="0.5" fill="var(--c-bg)" />
        <circle cx="0" cy="1.7" r="0.62" fill="var(--c-bg)" />
      </g>
    )
  }
  if (kind === 'toll') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <rect x="-4" y="-4" width="8" height="8" rx="1.4" fill={colour} stroke="var(--c-bg)" strokeWidth="1" />
        <path d="M-1.8 -1.8 H1.8 M-1.8 0 H1.8 M-1.8 1.8 H1.8" stroke="var(--c-bg)" strokeWidth="0.9" strokeLinecap="round" />
      </g>
    )
  }
  if (kind === 'park') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <path d="M-4 3.2 V-1.4 L0 -4.2 L4 -1.4 V3.2 Z" fill={colour}
          stroke="var(--c-bg)" strokeWidth="1" strokeLinejoin="round" />
        <rect x="-1" y="0.2" width="2" height="3" fill="var(--c-bg)" />
      </g>
    )
  }
  // fuel / ev
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="4.2" fill={colour} stroke="var(--c-bg)" strokeWidth="1" />
      {kind === 'ev'
        ? <path d="M0.9 -2.4 L-1.5 0.4 H0.1 L-0.7 2.5 L1.7 -0.4 H0.1 Z" fill="var(--c-bg)" />
        : <path d="M-1.3 -2.2 h2.1 v4.4 h-2.1 z M1.2 -1.1 h1 v2.2" fill="none" stroke="var(--c-bg)" strokeWidth="0.85" strokeLinejoin="round" />}
    </g>
  )
}

/** Gentle arc between two points so overlapping lanes stay readable. */
function arc(x1: number, y1: number, x2: number, y2: number, bend = 0.18) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  return `M ${x1} ${y1} Q ${mx - dy * bend} ${my + dx * bend} ${x2} ${y2}`
}

export function NetworkMap({
  routes = [], corridors = [], markers = [], showLabels = true, className,
  onMarkerClick, highlight,
}: {
  routes?: MapRoute[]
  corridors?: MapCorridor[]
  markers?: MapMarker[]
  showLabels?: boolean
  className?: string
  onMarkerClick?: (id: string) => void
  highlight?: string[]
}) {
  const [hover, setHover] = useState<MapMarker | null>(null)

  const grid = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    for (let lon = LON0; lon <= LON1; lon += 5) lines.push({ x1: px(lon), y1: 0, x2: px(lon), y2: H })
    for (let lat = LAT0; lat <= LAT1; lat += 5) lines.push({ x1: 0, y1: py(lat), x2: W, y2: py(lat) })
    return lines
  }, [])

  const shown = new Set(highlight ?? [])

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img"
        aria-label="Logistics network map of India showing nodes and active lanes">
        <defs>
          <radialGradient id="mapGlow" cx="48%" cy="42%" r="64%">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.10" />
            <stop offset="55%" stopColor="var(--c-brand)" stopOpacity="0.045" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="laneGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width={W} height={H} fill="url(#mapGlow)" />
        <g stroke="var(--c-grid)" strokeWidth="1" opacity="0.55">
          {grid.map((l, i) => <line key={i} {...l} />)}
        </g>

        {/* Infrastructure, under everything — GatiShakti corridors */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {corridors.map((c) => {
            const d = c.points.map((pt, i) =>
              `${i === 0 ? 'M' : 'L'} ${px(pt.lon)} ${py(pt.lat)}`).join(' ')
            return (
              <g key={c.id}>
                <path d={d} stroke="var(--c-faint)" strokeWidth="3.4" opacity="0.18" />
                <path d={d} stroke="var(--c-faint)" strokeWidth="1.3" opacity="0.6"
                  strokeDasharray={c.mode === 'rail' ? '7 4' : undefined} />
                {(c.pinches ?? []).map((p, i) => (
                  <path key={i}
                    d={`M ${px(p.a.lon)} ${py(p.a.lat)} L ${px(p.b.lon)} ${py(p.b.lat)}`}
                    stroke="var(--c-warn)" strokeWidth="2.6" opacity="0.85">
                    <title>{p.label}</title>
                  </path>
                ))}
              </g>
            )
          })}
        </g>

        {/* Lanes */}
        <g fill="none" strokeLinecap="round">
          {routes.map((r, i) => {
            const a = NODE_BY_CODE[r.from], b = NODE_BY_CODE[r.to]
            if (!a || !b) return null
            const dPath = arc(px(a.lon), py(a.lat), px(b.lon), py(b.lat))
            const colour = MODE_STROKE[r.mode]
            return (
              <g key={i}>
                <path d={dPath} stroke="var(--c-line)" strokeWidth={r.active ? 3 : 1.4}
                  opacity={r.active ? 0.85 : 0.4} />
                {r.active && (
                  <>
                    <path d={dPath} stroke={colour} strokeWidth="2.2" opacity="0.32"
                      filter="url(#laneGlow)" />
                    <path d={dPath} stroke={colour} strokeWidth="2" opacity="0.95"
                      strokeDasharray={MODE_DASH[r.mode] || '5 9'} className="route-flow" />
                  </>
                )}
              </g>
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {NODES.map((n) => {
            const isPort = n.kind === 'port'
            const lit = shown.size === 0 || shown.has(n.code)
            return (
              <g key={n.code} opacity={lit ? 1 : 0.28}>
                {isPort ? (
                  <rect x={px(n.lon) - 3.2} y={py(n.lat) - 3.2} width="6.4" height="6.4"
                    fill="var(--c-accent)" opacity="0.85" transform={`rotate(45 ${px(n.lon)} ${py(n.lat)})`} />
                ) : (
                  <circle cx={px(n.lon)} cy={py(n.lat)} r="3" fill="var(--c-faint)" />
                )}
                {showLabels && (
                  <text x={px(n.lon) + 7} y={py(n.lat) + 3.6} fontSize="10.5"
                    fill="var(--c-muted)" className="select-none pointer-events-none">
                    {n.code}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        {/* Live markers */}
        <g>
          {markers.map((m) => (
            <g key={m.id}
              onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)}
              onClick={() => onMarkerClick?.(m.id)}
              className={onMarkerClick ? 'cursor-pointer' : undefined}>
              {m.pulse && (
                <circle cx={px(m.lon)} cy={py(m.lat)} r={m.r ?? 4}
                  fill={TONE_VAR[m.tone]} className="ping-ring"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              )}
              {m.glyph && m.glyph !== 'dot' ? (
                <Glyph kind={m.glyph} x={px(m.lon)} y={py(m.lat)} colour={TONE_VAR[m.tone]} />
              ) : (
                <>
                  <circle cx={px(m.lon)} cy={py(m.lat)} r={(m.r ?? 4) + 2.5}
                    fill="var(--c-bg)" opacity="0.75" />
                  <circle cx={px(m.lon)} cy={py(m.lat)} r={m.r ?? 4} fill={TONE_VAR[m.tone]} />
                </>
              )}
            </g>
          ))}
        </g>
      </svg>

      {hover?.label && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium shadow-[var(--shadow-pop)]"
          style={{ left: `${(px(hover.lon) / W) * 100}%`, top: `${(py(hover.lat) / H) * 100 - 1.5}%` }}
        >
          {hover.label}
        </div>
      )}
    </div>
  )
}
