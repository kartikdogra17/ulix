import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Org, Session } from '../data/types'

type Theme = 'light' | 'dark'

interface AppState {
  session: Session | null
  signIn: (s: Session) => void
  signOut: () => void
  theme: Theme
  toggleTheme: () => void
  installPrompt: (() => void) | null
}

const Ctx = createContext<AppState | null>(null)
const LS_SESSION = 'ulip.session'
const LS_THEME = 'ulip.theme'

export const DEMO_ORGS: Org[] = [
  { id: 'org-ship', name: 'Tirupati Textiles Ltd', gstin: '27AAFCT4471K1Z9', role: 'Shipper',
    ulipClientId: 'ulip_cl_7f21a9', plan: 'Sandbox', members: 24 },
  { id: 'org-tran', name: 'Bharat Freightways', gstin: '24AABCB9902M1ZP', role: 'Transporter',
    ulipClientId: 'ulip_cl_2b88e4', plan: 'Production', members: 112 },
  { id: 'org-ff', name: 'Coromandel Freight Forwarders', gstin: '33AADCC1188Q1Z3', role: 'Freight Forwarder',
    ulipClientId: 'ulip_cl_9c40d1', plan: 'Production', members: 58 },
  { id: 'org-reg', name: 'State Logistics Cell', gstin: '07AAAGS0912R1ZK', role: 'Regulator',
    ulipClientId: 'ulip_cl_1a77bb', plan: 'Sandbox', members: 9 },
]

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(LS_THEME) as Theme | null
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked — fall through */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(LS_SESSION)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch { return null }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [installPrompt, setInstallPrompt] = useState<(() => void) | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0a0f1a' : '#f6f7f9')
    try { localStorage.setItem(LS_THEME, theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    try {
      if (session) localStorage.setItem(LS_SESSION, JSON.stringify(session))
      else localStorage.removeItem(LS_SESSION)
    } catch { /* ignore */ }
  }, [session])

  // PWA install affordance — the "app based" half of the platform.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      const deferred = e as Event & { prompt: () => Promise<void> }
      setInstallPrompt(() => () => { void deferred.prompt(); setInstallPrompt(null) })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const signIn = useCallback((s: Session) => setSession(s), [])
  const signOut = useCallback(() => setSession(null), [])
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const value = useMemo(
    () => ({ session, signIn, signOut, theme, toggleTheme, installPrompt }),
    [session, signIn, signOut, theme, toggleTheme, installPrompt],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
