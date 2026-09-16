import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity, Boxes, Building2, Container, Download, FileCheck2, FlaskConical,
  LayoutGrid, LogOut, Moon, Plug, Route, Search, Settings, Sun, Truck, X,
} from 'lucide-react'
import { useApp } from '../state/app'
import { ULIP_MODE } from '../data'
import { cn } from '../lib/cn'
import { Badge, Button } from './ui'

const NAV = [
  { to: '/', label: 'Control tower', short: 'Tower', icon: LayoutGrid, end: true },
  { to: '/shipments', label: 'Consignments', short: 'Cargo', icon: Boxes },
  { to: '/plan', label: 'Lane planner', short: 'Plan', icon: Route },
  { to: '/drill', label: 'Scenario drill', short: 'Drill', icon: FlaskConical },
  { to: '/fleet', label: 'Fleet', short: 'Fleet', icon: Truck },
  { to: '/exim', label: 'EXIM', short: 'EXIM', icon: Container },
  { to: '/compliance', label: 'Compliance', short: 'Docs', icon: FileCheck2 },
  { to: '/parties', label: 'Counterparties', short: 'Parties', icon: Building2 },
  { to: '/apis', label: 'API gateway', short: 'APIs', icon: Plug },
]

function ModeBanner() {
  const [open, setOpen] = useState(true)
  if (ULIP_MODE === 'live' || !open) return null
  return (
    <div className="flex items-start gap-2 border-b border-warn/25 bg-warn-soft px-4 py-2 text-[12px] text-warn">
      <Activity className="mt-0.5 size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Simulated gateway.</span>{' '}
        Endpoint codes, payloads and the response envelope follow the official ULIP
        integration documents, but no live government data is being fetched. Connect real
        datasets via the proxy once your goulip.in access is approved.
      </p>
      <button onClick={() => setOpen(false)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function Shell() {
  const { session, signOut, theme, toggleTheme, installPrompt } = useApp()
  const loc = useLocation()
  const [q, setQ] = useState('')

  // Global "/" focuses search, the way an ops console should behave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement)?.closest('input,textarea,select')) {
        e.preventDefault()
        document.getElementById('global-search')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-lg">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-brand text-brand-fg">
              <Boxes className="size-4.5" strokeWidth={2.4} />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight">ULIP</div>
              <div className="hidden text-[10px] uppercase tracking-wide text-faint sm:block">
                Unified Logistics Interface
              </div>
            </div>
          </div>

          <form
            className="relative ml-auto hidden max-w-sm flex-1 md:block"
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) window.location.hash = `#/shipments?q=${encodeURIComponent(q.trim())}`
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              id="global-search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search CN, e-Way Bill, vehicle…"
              className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-10 text-[13px] placeholder:text-faint focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 font-mono text-[10px] text-faint">/</kbd>
          </form>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            {installPrompt && (
              <Button size="sm" variant="outline" onClick={installPrompt} className="hidden sm:inline-flex">
                <Download className="size-3.5" /> Install app
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={toggleTheme} aria-label="Toggle colour theme">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <NavLink to="/settings" className={({ isActive }) =>
              cn('grid size-8 place-items-center rounded-lg transition-colors',
                isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              <Settings className="size-4" />
            </NavLink>
            <div className="ml-1 hidden items-center gap-2 border-l border-line pl-3 sm:flex">
              <div className="text-right leading-tight">
                <div className="text-[12px] font-medium">{session?.name}</div>
                <div className="text-[10px] text-faint">{session?.org.name}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={signOut} aria-label="Sign out">
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <ModeBanner />

      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar (desktop) ─────────────────────────────── */}
        <nav className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-0.5 border-r border-line p-3 lg:flex">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) =>
              cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg')}>
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
          <div className="mt-auto rounded-lg border border-line bg-surface p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Badge tone={ULIP_MODE === 'live' ? 'ok' : 'warn'} dot>
                {ULIP_MODE === 'live' ? 'Live gateway' : 'Simulated'}
              </Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              {session?.org.plan} client<br />
              <span className="font-mono text-[10px]">{session?.org.ulipClientId}</span>
            </p>
          </div>
        </nav>

        {/* ── Page ──────────────────────────────────────────── */}
        <main key={loc.pathname} className="fade-up min-w-0 flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* ── Bottom nav (mobile) ───────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-9 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        {NAV.map(({ to, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) =>
            cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand' : 'text-faint')}>
            <Icon className="size-5" /> {short}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
