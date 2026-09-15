import { ULIP_BASE, ULIP_LOGIN_PATH, endpointById } from './catalogue'
import { UlipError, type UlipEnvelope, unwrap } from './envelope'

export interface UlipClientOptions {
  /**
   * Where to send requests. In the browser this MUST be your own proxy
   * (see server/ulip-proxy.mjs) — never the ULIP host directly, because
   * the gateway is authenticated with a long-lived username/password
   * that cannot be shipped to a client.
   */
  baseUrl: string
  /** Only for server-side use. Omit in the browser. */
  credentials?: { username: string; password: string }
  /** Supply a token directly when something else owns the login. */
  token?: string
  fetchImpl?: typeof fetch
  /** Re-login this many ms before the documented 30-minute idle expiry. */
  refreshMarginMs?: number
}

const IDLE_SESSION_MS = 30 * 60_000

/**
 * Thin, faithful client for the documented ULIP contract:
 *   POST {base}/user/login            → { token }
 *   POST {base}/{SYSTEM}/{NN}         → UlipEnvelope
 * with `Authorization: Bearer <token>` on every dataset call.
 */
export class UlipClient {
  private readonly opts: UlipClientOptions
  private readonly http: typeof fetch
  private token: string | null
  private tokenIssuedAt = 0
  private inflightLogin: Promise<string> | null = null

  constructor(opts: UlipClientOptions) {
    this.opts = opts
    this.http = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.token = opts.token ?? null
    if (opts.token) this.tokenIssuedAt = Date.now()
  }

  private get margin() { return this.opts.refreshMarginMs ?? 60_000 }

  private tokenIsFresh() {
    return !!this.token && Date.now() - this.tokenIssuedAt < IDLE_SESSION_MS - this.margin
  }

  /** Logs in if needed. Concurrent callers share one in-flight request. */
  async authenticate(force = false): Promise<string> {
    if (!force && this.tokenIsFresh()) return this.token!
    if (this.inflightLogin) return this.inflightLogin

    const creds = this.opts.credentials
    if (!creds) {
      throw new UlipError(401, 'No ULIP token and no credentials available. In the browser, point baseUrl at your proxy.')
    }

    this.inflightLogin = (async () => {
      const res = await this.http(`${this.opts.baseUrl}${ULIP_LOGIN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
      })
      const body = (await res.json().catch(() => null)) as
        | { token?: string; response?: { token?: string }; message?: string }
        | null
      const token = body?.token ?? body?.response?.token
      if (!res.ok || !token) {
        throw new UlipError(res.status || 401, body?.message ?? 'ULIP login failed')
      }
      this.token = token
      this.tokenIssuedAt = Date.now()
      return token
    })()

    try { return await this.inflightLogin } finally { this.inflightLogin = null }
  }

  /** Validate a payload against the regexes quoted in the integration docs. */
  static validate(endpointId: string, payload: Record<string, unknown>): string | null {
    const ep = endpointById(endpointId)
    if (!ep) return `Unknown endpoint ${endpointId}`
    for (const p of ep.params) {
      const raw = payload[p.name]
      if (raw === undefined || raw === null || raw === '') continue
      if (!p.format) continue
      let re: RegExp
      try { re = new RegExp(p.format.startsWith('^') ? p.format : `^(?:${p.format})$`) }
      catch { continue }
      if (!re.test(String(raw))) {
        return `Data format failed OR wrong value entered at: ${p.name}. Format should follow ${p.format}`
      }
    }
    return null
  }

  /** Raw call — returns the envelope untouched. */
  async callRaw<T>(endpointId: string, payload: Record<string, unknown>): Promise<UlipEnvelope<T>> {
    const invalid = UlipClient.validate(endpointId, payload)
    if (invalid) throw new UlipError(400, invalid, endpointId)

    const send = async (token: string) =>
      this.http(`${this.opts.baseUrl}/${endpointId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

    let res = await send(await this.authenticate())
    // A 401/403 mid-session means the token lapsed: re-login once and retry.
    if (res.status === 401 || res.status === 403) {
      res = await send(await this.authenticate(true))
    }

    const body = (await res.json().catch(() => null)) as UlipEnvelope<T> | null
    if (!body) throw new UlipError(res.status || 502, 'ULIP returned a non-JSON response', endpointId)
    if (!res.ok && body.error !== 'true') {
      throw new UlipError(res.status, body.message ?? `ULIP returned HTTP ${res.status}`, endpointId, body)
    }
    return body
  }

  /** Call and unwrap to the records the source system actually resolved. */
  async call<T>(endpointId: string, payload: Record<string, unknown>): Promise<T[]> {
    return unwrap<T>(await this.callRaw<T>(endpointId, payload), endpointId)
  }
}

export const ulipUrl = (env: keyof typeof ULIP_BASE, endpointId: string) =>
  `${ULIP_BASE[env]}/${endpointId}`
