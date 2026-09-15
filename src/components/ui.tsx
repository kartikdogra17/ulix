import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import type { Tone } from '../lib/status'

/* ── Surface ─────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHead({ title, sub, right, className }: {
  title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

/* ── Badge ───────────────────────────────────────────────────── */

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  info: 'bg-info-soft text-info border-info/25',
  brand: 'bg-brand-soft text-brand border-brand/25',
  neutral: 'bg-surface-2 text-muted border-line',
}

export function Badge({ tone = 'neutral', dot, children, className }: {
  tone?: Tone; dot?: boolean; children: ReactNode; className?: string
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
      TONE_CLASS[tone], className,
    )}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* ── Button ──────────────────────────────────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'outline', size = 'md', className, ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-[13px]' }
  const variants = {
    primary: 'bg-brand text-brand-fg hover:opacity-90',
    outline: 'border border-line bg-surface hover:bg-surface-2',
    ghost: 'hover:bg-surface-2 text-muted hover:text-fg',
    danger: 'border border-bad/30 bg-bad-soft text-bad hover:bg-bad/15',
  }
  return <button {...rest} className={cn(base, sizes[size], variants[variant], className)} />
}

/* ── Inputs ──────────────────────────────────────────────────── */

const fieldCls = 'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-fg placeholder:text-faint focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20'

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input {...p} className={cn(fieldCls, p.className)} />

export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...p} className={cn(fieldCls, 'cursor-pointer appearance-none bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat pr-8', p.className)}
    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b94a6' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, ...p.style }} />

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

/* ── Tabs ────────────────────────────────────────────────────── */

const TabCtx = createContext<{ value: string; set: (v: string) => void } | null>(null)

export function Tabs({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return <TabCtx.Provider value={{ value, set: onChange }}>{children}</TabCtx.Provider>
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {children}
    </div>
  )
}

export function Tab({ id, children, count }: { id: string; children: ReactNode; count?: number }) {
  const ctx = useContext(TabCtx)!
  const active = ctx.value === id
  return (
    <button
      onClick={() => ctx.set(id)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
        active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tnum rounded px-1 text-[10px]', active ? 'bg-surface-3 text-muted' : 'text-faint')}>{count}</span>
      )}
    </button>
  )
}

/* ── Table shell ─────────────────────────────────────────────── */

export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) =>
  <th {...p} className={cn('whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint', className)} />

export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) =>
  <td {...p} className={cn('px-3 py-2.5 align-middle text-[13px]', className)} />

/* ── States ──────────────────────────────────────────────────── */

export function Empty({ icon: Icon, title, sub, action }: {
  icon?: React.ComponentType<{ className?: string }>; title: string; sub?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && <Icon className="mb-3 size-7 text-faint" />}
      <p className="text-sm font-medium">{title}</p>
      {sub && <p className="mt-1 max-w-sm text-[13px] text-muted">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export const Skeleton = ({ className }: { className?: string }) =>
  <div className={cn('skeleton rounded-md', className)} />

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-5', c === 0 ? 'w-28' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Drawer ──────────────────────────────────────────────────── */

export function Drawer({ open, onClose, title, sub, children, width = 'max-w-2xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true"
        className={cn('relative flex h-full w-full flex-col bg-bg shadow-[var(--shadow-pop)] outline-none sm:border-l sm:border-line', width)}
        style={{ animation: 'ulip-fade-up .22s cubic-bezier(.16,1,.3,1) both' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">{title}</h2>
            {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  )
}

/* ── Misc ────────────────────────────────────────────────────── */

export function Meter({ value, tone = 'brand', className }: { value: number; tone?: Tone; className?: string }) {
  const bar: Record<Tone, string> = {
    ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', brand: 'bg-brand', neutral: 'bg-faint',
  }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', bar[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn('font-mono text-[12px] tracking-tight', className)}>{children}</span>

export function KeyVal({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted">{k}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] font-medium', mono && 'font-mono text-[12px]')}>{v}</dd>
    </div>
  )
}
