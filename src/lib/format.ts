export const inr = (n: number, compact = true) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: compact && n >= 1e5 ? 2 : 0,
    notation: compact && n >= 1e5 ? 'compact' : 'standard',
  }).format(n)

export const num = (n: number, dp = 0) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n)

export const compact = (n: number) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export const kg = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} t` : `${num(n)} kg`)

const dtf = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})
const dtfFull = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const df = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export const dt = (iso: string) => dtf.format(new Date(iso))
export const dtFull = (iso: string) => dtfFull.format(new Date(iso))
export const d = (iso: string) => df.format(new Date(iso))

export function rel(iso: string) {
  const diff = Date.now() - Date.parse(iso)
  const mins = Math.round(diff / 60000)
  if (Math.abs(mins) < 1) return 'just now'
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins}m ago` : `in ${-mins}m`
  const hrs = Math.round(mins / 60)
  if (Math.abs(hrs) < 24) return hrs > 0 ? `${hrs}h ago` : `in ${-hrs}h`
  const days = Math.round(hrs / 24)
  return days > 0 ? `${days}d ago` : `in ${-days}d`
}

export function dur(mins: number) {
  const a = Math.abs(Math.round(mins))
  if (a < 60) return `${a}m`
  const h = Math.floor(a / 60), m = a % 60
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Days from now until `iso`; negative when already past. */
export const daysTo = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)

export const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
