import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity, Boxes, Building2, Container, Download, FileCheck2, FlaskConical,
  LayoutGrid, LogOut, Moon, MoreHorizontal, Plug, Route, Search, Settings,
  Sun, Truck, Waves, X,
} from 'lucide-react'
import { useApp } from '../state/app'
import { MODULE_LABEL, lensFor, navRank, type RoleLens } from '../data/roles'
import { ULIP_MODE } from '../data'
import { Logo } from './Logo'
import { cn } from '../lib/cn'
import { Badge, Button } from './ui'

/* Ten modules is past what a bottom bar can hold — nine at 42px was already
   the ceiling. So the sidebar groups them by what you are doing, and the
   mobile bar keeps four you reach for constantly plus a More sheet. */
interface NavItem {
  /** The visible name comes from MODULE_LABEL — named once, in the lens. */
  to: string; short: string
  icon: React.ComponentType<{ className?: string }>; end?: boolean
}

const OPERATE: NavItem[] = [
  { to: '/', short: 'Tower', icon: LayoutGrid, end: true },
  { to: '/shipments', short: 'Cargo', icon: Boxes },
  { to: '/fleet', short: 'Fleet', icon: Truck },
  { to: '/exim', short: 'EXIM', icon: Container },
  { to: '/compliance', short: 'Docs', icon: FileCheck2 },
]

const PLAN: NavItem[] = [
  { to: '/plan', short: 'Plan', icon: Route },
  { to: '/waterways', short: 'Water', icon: Waves },
  { to: '/drill', short: 'Drill', icon: FlaskConical },
  { to: '/parties', short: 'Parties', icon: Building2 },
]

const PLATFORM: NavItem[] = [
  { to: '/apis', short: 'APIs', icon: Plug },
]

const GROUPS: Array<[string, NavItem[]]> = [
  ['Operate', OPERATE], ['Plan & verify', PLAN], ['Platform', PLATFORM],
]

const ALL_NAV = [...OPERATE, ...PLAN, ...PLATFORM]

/**
 * The same information architecture, filtered and ordered for whoever is
 * signed in. Groups keep their meaning across roles — only membership and
 * order change — so somebody who learns this sidebar at one organisation
 * does not have to relearn it at the next. What a role does not see here
 * is un-advertised, not forbidden: every route still resolves by URL.
 */
function groupsFor(lens: RoleLens): Array<[string, NavItem[]]> {
  return GROUPS
    .map(([name, items]) => [
      name,
      items
        .filter((n) => navRank(lens, n.to) >= 0)
        .sort((a, b) => navRank(lens, a.to) - navRank(lens, b.to)),
    ] as [string, NavItem[]])
    .filter(([, items]) => items.length > 0)
}

function ModeBanner() {
  const [open, setOpen] = useState(true)
  if (ULIP_MODE === 'live' || !open) return null
  return (
    <div className="flex items-start gap-2 border-b border-warn/25 bg-warn-soft px-4 py-2 text-[12px] text-warn">
      <Activity className="mt-0.5 size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Simulated gateway.</span>{' '}
        Endpoint codes, payloads and the response envelope follow the official ULIP
        integration documents, but no live government data is being fetched. Connect
        real datasets via the proxy once your goulip.in access is approved.
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
  const [moreOpen, setMoreOpen] = useState(false)

  const lens = lensFor(session?.org.role ?? 'Shipper')
  const groups = useMemo(() => groupsFor(lens), [lens])
  const mobilePrimary = lens.mobilePrimary
  const navLabel = (to: string) => (to === '/' ? lens.towerTitle : MODULE_LABEL[to])

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

  // A route change should never leave the sheet hanging open behind the page.
  useEffect(() => { setMoreOpen(false) }, [loc.pathname])

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-lg">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <Logo tileClass="size-8 rounded-lg" />

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
        <nav className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3 lg:flex">
          {groups.map(([group, items], gi) => (
            <div key={group} className={cn(gi > 0 && 'mt-3')}>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                {group}
              </div>
              {items.map(({ to, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) =>
                  cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg')}>
                  <Icon className="size-4" /> {navLabel(to)}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="flex-1" />
          <div className="mt-auto rounded-lg border border-line bg-surface p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Badge tone={ULIP_MODE === 'live' ? 'ok' : 'warn'} dot>
                {ULIP_MODE === 'live' ? 'Live gateway' : 'Simulated'}
              </Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              <span className="font-medium text-muted">{lens.role} view</span><br />
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
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        {mobilePrimary.flatMap((to) => ALL_NAV.filter((n) => n.to === to)).map(({ to, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) =>
            cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand' : 'text-faint')}>
            <Icon className="size-5" /> {short}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)}
          className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
            moreOpen || !mobilePrimary.includes(loc.pathname) ? 'text-brand' : 'text-faint')}>
          <MoreHorizontal className="size-5" /> More
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-bg p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
            style={{ animation: 'ulip-fade-up .2s cubic-bezier(.16,1,.3,1) both' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            {groups.map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  {group}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map(({ to, icon: Icon, end }) => (
                    <NavLink key={to} to={to} end={end} onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium',
                          isActive ? 'border-brand/40 bg-brand-soft text-brand' : 'border-line')}>
                      <Icon className="size-4" /> {navLabel(to)}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
