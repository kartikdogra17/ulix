import type { DataAdapter } from './adapter'
import { MockAdapter } from './mock'

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
export const ULIP_MODE = import.meta.env.VITE_ULIP_MODE === 'live' ? 'live' : 'mock'
export const ULIP_PROXY = import.meta.env.VITE_ULIP_PROXY ?? 'http://localhost:8787/api/ulip'

export const adapter: DataAdapter = new MockAdapter()

export type { DataAdapter }
