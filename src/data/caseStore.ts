/* ────────────────────────────────────────────────────────────────
   Where case work is kept.

   Case state was per-browser localStorage, which meant two controllers
   never saw each other's assignments — the one honest limitation the
   README kept flagging. It now prefers a shared store on the proxy and
   falls back to local storage when that is not running, so a bare
   `npm run dev` still works.

   Concurrency is optimistic. Every record carries a version; a write
   pins the version it was read at, and the server rejects a write whose
   pin no longer matches. The caller refetches and reapplies rather than
   silently clobbering a colleague — which is the whole point of moving
   off localStorage in the first place.
   ──────────────────────────────────────────────────────────────── */

import type { CaseRecord } from './cases'
import { loadCases, saveCases } from './cases'
import { CASES_BASE } from './config'

export type StoreKind = 'server' | 'local'

export interface StoredCase {
  record: CaseRecord
  version: number
}

export interface SaveResult {
  ok: boolean
  /** On conflict, the record as it now stands on the server. */
  current?: StoredCase
}

export interface CaseStore {
  readonly kind: StoreKind
  load(): Promise<Record<string, StoredCase>>
  save(signalId: string, record: CaseRecord, ifVersion: number): Promise<SaveResult>
}

/* ── Local fallback ───────────────────────────────────────────── */

class LocalCaseStore implements CaseStore {
  readonly kind = 'local' as const
  private versions = new Map<string, number>()

  async load() {
    const raw = loadCases()
    const out: Record<string, StoredCase> = {}
    for (const [id, record] of Object.entries(raw)) {
      const version = this.versions.get(id) ?? 1
      this.versions.set(id, version)
      out[id] = { record, version }
    }
    return out
  }

  async save(signalId: string, record: CaseRecord) {
    const raw = loadCases()
    raw[signalId] = record
    saveCases(raw)
    this.versions.set(signalId, (this.versions.get(signalId) ?? 1) + 1)
    return { ok: true }
  }
}

/* ── Shared store on the proxy ────────────────────────────────── */

class ServerCaseStore implements CaseStore {
  readonly kind = 'server' as const

  async load() {
    const res = await fetch(`${CASES_BASE}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`case store unavailable (${res.status})`)
    const body = await res.json() as { cases: Record<string, StoredCase> }
    return body.cases ?? {}
  }

  async save(signalId: string, record: CaseRecord, ifVersion: number): Promise<SaveResult> {
    const res = await fetch(`${CASES_BASE}/${encodeURIComponent(signalId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record, ifVersion }),
    })
    if (res.status === 409) {
      const body = await res.json() as { current: StoredCase }
      return { ok: false, current: body.current }
    }
    if (!res.ok) throw new Error(`case write failed (${res.status})`)
    return { ok: true }
  }
}

/* ── Selection ────────────────────────────────────────────────── */

let resolved: CaseStore | null = null

/**
 * Probe the proxy once. If it answers, everyone shares a queue; if not,
 * the session keeps working on its own copy.
 */
export async function caseStore(): Promise<CaseStore> {
  if (resolved) return resolved
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(`${CASES_BASE}`, { signal: ctrl.signal })
    clearTimeout(timer)
    resolved = res.ok ? new ServerCaseStore() : new LocalCaseStore()
  } catch {
    resolved = new LocalCaseStore()
  }
  return resolved
}

/** For the UI to say which it is, without probing again. */
export const currentStoreKind = (): StoreKind | null => resolved?.kind ?? null
