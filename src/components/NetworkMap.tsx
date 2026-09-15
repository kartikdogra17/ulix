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
export interface MapMarker {
  id: string; lat: number; lon: number
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'brand'
  label?: string; pulse?: boolean; r?: number
}

const TONE_VAR = {
  ok: 'var(--c-ok)', warn: 'var(--c-warn)', bad: 'var(--c-bad)',
  info: 'var(--c-accent)', brand: 'var(--c-brand)',
} as const

const MODE_DASH: Record<Mode, string> = {
  road: '', rail: '10 5', sea: '2 6', air: '16 8',
}

/** Gentle arc between two points so overlapping lanes stay readable. */
function arc(x1: number, y1: number, x2: number, y2: number, bend = 0.18) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  return `M ${x1} ${y1} Q ${mx - dy * bend} ${my + dx * bend} ${x2} ${y2}`
}

export function NetworkMap({
  routes = [], markers = [], showLabels = true, className, onMarkerClick, highlight,
}: {
  routes?: MapRoute[]
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
          <radialGradient id="mapGlow" cx="50%" cy="45%" r="62%">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.09" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={W} height={H} fill="url(#mapGlow)" />
        <g stroke="var(--c-grid)" strokeWidth="1" opacity="0.7">
          {grid.map((l, i) => <line key={i} {...l} />)}
        </g>

        {/* Lanes */}
        <g fill="none" strokeLinecap="round">
          {routes.map((r, i) => {
            const a = NODE_BY_CODE[r.from], b = NODE_BY_CODE[r.to]
            if (!a || !b) return null
            const dPath = arc(px(a.lon), py(a.lat), px(b.lon), py(b.lat))
            return (
              <g key={i}>
                <path d={dPath} stroke="var(--c-line)" strokeWidth={r.active ? 2.4 : 1.4} opacity={r.active ? 0.9 : 0.45} />
                {r.active && (
                  <path d={dPath} stroke="var(--c-brand)" strokeWidth="2" opacity="0.95"
                    strokeDasharray={MODE_DASH[r.mode] || '5 9'} className="route-flow" />
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
              <circle cx={px(m.lon)} cy={py(m.lat)} r={(m.r ?? 4) + 2.5}
                fill="var(--c-bg)" opacity="0.75" />
              <circle cx={px(m.lon)} cy={py(m.lat)} r={m.r ?? 4} fill={TONE_VAR[m.tone]} />
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
