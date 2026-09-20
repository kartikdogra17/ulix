/* ────────────────────────────────────────────────────────────────
   Runtime configuration.

   Deliberately dependency-free. These constants used to live in
   data/index.ts, which also constructs the adapter — so anything the
   adapter imports could not read them without a cycle, and the app
   died at load with "Cannot access 'OSINT_BASE' before initialization".
   Keeping configuration in a leaf module makes that impossible.
   ──────────────────────────────────────────────────────────────── */

/**
 * Vite substitutes `import.meta.env` at build time. Node does not have it,
 * and reading a property off the resulting `undefined` threw — which made
 * the whole data layer unimportable outside a browser, and so untestable
 * and unschedulable. Defaulting to an empty object costs nothing in the
 * bundle and makes fusion, cases and notify run under plain Node.
 */
const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

export const ULIP_MODE = ENV.VITE_ULIP_MODE === 'live' ? 'live' : 'mock'

/** Your own proxy, never the ULIP host directly — it holds the credentials. */
export const ULIP_PROXY =
  ENV.VITE_ULIP_PROXY ?? 'http://localhost:8787/api/ulip'

const API_ROOT = ULIP_PROXY.replace(/\/ulip\/?$/, '')

/** Open-source feeds the proxy fronts (AIS forbids browsers; GDELT rate-limits). */
export const OSINT_BASE = `${API_ROOT}/osint`

/** Shared case store, so two controllers see the same queue. */
export const CASES_BASE = `${API_ROOT}/cases`

/** Outbound delivery. The webhook URL stays server-side, never in the browser. */
export const NOTIFY_BASE = `${API_ROOT}/notify`
