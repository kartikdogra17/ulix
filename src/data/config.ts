/* ────────────────────────────────────────────────────────────────
   Runtime configuration.

   Deliberately dependency-free. These constants used to live in
   data/index.ts, which also constructs the adapter — so anything the
   adapter imports could not read them without a cycle, and the app
   died at load with "Cannot access 'OSINT_BASE' before initialization".
   Keeping configuration in a leaf module makes that impossible.
   ──────────────────────────────────────────────────────────────── */

export const ULIP_MODE = import.meta.env.VITE_ULIP_MODE === 'live' ? 'live' : 'mock'

/** Your own proxy, never the ULIP host directly — it holds the credentials. */
export const ULIP_PROXY =
  import.meta.env.VITE_ULIP_PROXY ?? 'http://localhost:8787/api/ulip'

const API_ROOT = ULIP_PROXY.replace(/\/ulip\/?$/, '')

/** Open-source feeds the proxy fronts (AIS forbids browsers; GDELT rate-limits). */
export const OSINT_BASE = `${API_ROOT}/osint`

/** Shared case store, so two controllers see the same queue. */
export const CASES_BASE = `${API_ROOT}/cases`
