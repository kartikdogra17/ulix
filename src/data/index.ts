import type { DataAdapter } from './adapter'
import { MockAdapter } from './mock'
import { UlipAdapter } from './ulip/adapter'
import { ULIP_MODE, ULIP_PROXY } from './config'

/**
 * Single swap point for the entire application.
 *
 * Mock mode (default) simulates the ULIP gateway locally — same endpoint
 * codes, same envelope, same status codes and validation messages as the
 * published integration documents in docs/ulip-api/.
 *
 * To go live:
 *   1. Register on https://goulip.in, sign the NDA, submit your use case and
 *      get your datasets approved (staging first, then production).
 *   2. Run the proxy that holds those credentials:
 *        ULIP_USERNAME=… ULIP_PASSWORD=… node server/ulip-proxy.mjs
 *   3. Start the app with:
 *        VITE_ULIP_MODE=live VITE_ULIP_PROXY=http://localhost:8787/api/ulip
 *
 * The browser never sees the ULIP username, password or bearer token.
 */
// Configuration lives in a leaf module so adapter-side code can read it
// without importing this file, which constructs the adapter.
export { ULIP_MODE, ULIP_PROXY, OSINT_BASE, CASES_BASE } from './config'

/**
 * Live mode must never dress the simulator up as the gateway.
 *
 * Until this line could choose a real adapter, `VITE_ULIP_MODE=live` did
 * something worse than nothing: it dropped the "Simulated gateway" banner
 * and turned the sidebar badge green while every figure on screen stayed
 * seeded PRNG output. One env var was enough to break the invariant this
 * project states twice and relies on for its credibility.
 *
 * So the flag now selects an adapter, and a live mode that cannot be
 * satisfied fails loudly at load instead of quietly relabelling the mock.
 * A blank screen with an explanation is recoverable; a confident green
 * badge over invented data is not.
 */
function selectAdapter(): DataAdapter {
  if (ULIP_MODE !== 'live') return new MockAdapter()
  return new UlipAdapter({ baseUrl: ULIP_PROXY })
}

export const adapter: DataAdapter = selectAdapter()

export type { DataAdapter }
