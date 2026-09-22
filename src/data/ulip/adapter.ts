/* ────────────────────────────────────────────────────────────────
   The live adapter.

   Writing this surfaced the thing that should shape the product:
   ULIP IS A LOOKUP API, NOT A LIST API. Every endpoint is keyed by an
   identifier you must already hold — FASTAG/01 and VAHAN/01 want a
   vehicle number, EWAYBILL/01 an e-Way Bill number, SARATHI/01 a licence
   number and a date of birth, FOIS/01 an FNR. There is no endpoint that
   answers "what am I shipping today".

   So this is not a drop-in replacement for the simulator. It is an
   ENRICHMENT layer, and the consignment book has to come from the
   customer's own TMS or ERP. Anything here that needs that book says so
   in as many words rather than returning an empty array, because an
   empty table is indistinguishable from a broken one and this codebase
   has already paid for that lesson twice.

   What genuinely works against a live gateway today: vehicle lookup
   across VAHAN and FASTag, and the API console. That is a real, honest
   day-one demo, and it is more than the simulator could ever prove.
   ──────────────────────────────────────────────────────────────── */

import type { ApiCall, ComplianceDoc, Exception, Shipment, Vehicle } from '../types'
import type {
  CaseQuery, Dashboard, DataAdapter, DocQuery, Fused360, Page, ShipmentQuery, VehicleQuery,
} from '../adapter'
import type { CatalogueEntry } from '../mock/gateway'
import { ULIP_ENDPOINTS } from './catalogue'
import { UlipClient } from './client'
import { UlipError, type UlipEnvelope, isNotFound } from './envelope'
import {
  boeFound, toBoe, toEwayBill, toRake, toVehicle,
  type BoeRecord, type EwayBillRecord, type FastagRecord, type FoisRecord,
  type LiveBoe, type LiveEwayBill, type LiveRake, type VahanRecord,
} from './map'

/**
 * Thrown by everything ULIP structurally cannot answer.
 *
 * The message is the product statement, so it is written for whoever hits
 * it: what is missing, why the gateway cannot provide it, and where it
 * has to come from instead.
 */
export class NotWiredError extends Error {
  readonly kind = 'not-wired'
  readonly capability: string
  readonly because: string
  constructor(capability: string, because: string) {
    super(`${capability} is not available from ULIP. ${because}`)
    this.name = 'NotWiredError'
    this.capability = capability
    this.because = because
  }
}

const NEEDS_BOOK =
  'ULIP has no endpoint that lists consignments — every dataset is a lookup keyed by an '
  + 'identifier you already hold. Connect your TMS or ERP as the source of the consignment '
  + 'book; ULIP then enriches each record against the government registers.'

const notWired = (capability: string, because = NEEDS_BOOK): never => {
  throw new NotWiredError(capability, because)
}

export interface UlipAdapterOptions {
  /** Your proxy, never the gateway host — it holds the credentials. */
  baseUrl: string
  fetchImpl?: typeof fetch
}

export class UlipAdapter implements DataAdapter {
  readonly id = 'ulip'
  readonly label = 'ULIP gateway'
  readonly live = true

  private readonly client: UlipClient
  /** Calls this session actually made, so the console shows truth. */
  private readonly log: ApiCall[] = []

  constructor(opts: UlipAdapterOptions) {
    this.client = new UlipClient({ baseUrl: opts.baseUrl, fetchImpl: opts.fetchImpl })
  }

  private record(endpointId: string, status: number, startedAt: number, bytes: number, resolved: boolean) {
    this.log.unshift({
      id: `${endpointId}-${startedAt}`,
      ts: new Date(startedAt).toISOString(),
      endpointId,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      bytes,
      consumer: 'ops-console',
      resolved,
    })
    if (this.log.length > 500) this.log.length = 500
  }

  /* ── What the gateway can genuinely answer ─────────────────── */

  /**
   * A vehicle, joined across VAHAN and FASTag.
   *
   * Partial by construction: the registers do not carry permit validity,
   * tag balance or a driver, so `toVehicle` reports those as declared gaps
   * rather than filling them in. A caller that needs a whole Vehicle has
   * to reconcile against its own records; that is the honest contract.
   */
  async getVehicle(regNo: string): Promise<Vehicle | null> {
    const started = performance.now()
    let vahan: VahanRecord[] = []
    try {
      const env = await this.client.callRaw<VahanRecord>('VAHAN/01', { vehiclenumber: regNo })
      if (isNotFound(env)) { this.record('VAHAN/01', 200, started, 0, false); return null }
      vahan = flatten(env)
      this.record('VAHAN/01', 200, started, JSON.stringify(env).length, true)
    } catch (err) {
      this.record('VAHAN/01', err instanceof UlipError ? err.code : 502, started, 0, false)
      throw err
    }
    if (!vahan.length) return null

    // FASTag is additive: no toll reads is a fact about the vehicle, not a
    // failure, so a dead call here must not lose the VAHAN answer.
    let tolls: FastagRecord[] = []
    const tollStarted = performance.now()
    try {
      const env = await this.client.callRaw<FastagRecord>('FASTAG/01', { vehiclenumber: regNo })
      tolls = isNotFound(env) ? [] : flatten(env)
      this.record('FASTAG/01', 200, tollStarted, JSON.stringify(env).length, !isNotFound(env))
    } catch {
      this.record('FASTAG/01', 502, tollStarted, 0, false)
    }

    const { known } = toVehicle(regNo, vahan[0], tolls)
    return known as Vehicle
  }

  /**
   * One e-Way Bill, as the gateway has it.
   *
   * Not on DataAdapter: the interface deals in consignments, and a bill is
   * a lookup by a number you already hold. `/import` gives you those
   * numbers; this resolves them. Returns null when the bill is unknown —
   * which the envelope reports as a 200, hence isNotFound.
   */
  async ewayBill(ewbNo: string): Promise<LiveEwayBill | null> {
    const started = performance.now()
    try {
      const env = await this.client.callRaw<EwayBillRecord>('EWAYBILL/01', { ewbNo })
      if (isNotFound(env)) { this.record('EWAYBILL/01', 200, started, 0, false); return null }
      const records = flatten(env)
      this.record('EWAYBILL/01', 200, started, JSON.stringify(env).length, true)
      return records.length ? toEwayBill(records[0]) : null
    } catch (err) {
      this.record('EWAYBILL/01', err instanceof UlipError ? err.code : 502, started, 0, false)
      throw err
    }
  }

  /** One rake, by FNR. */
  async rake(fnrnumber: string): Promise<LiveRake | null> {
    const started = performance.now()
    try {
      const env = await this.client.callRaw<FoisRecord>('FOIS/01', { fnrnumber })
      if (isNotFound(env)) { this.record('FOIS/01', 200, started, 0, false); return null }
      const rows = flatten(env)
      this.record('FOIS/01', 200, started, JSON.stringify(env).length, rows.length > 0)
      return rows.length ? toRake(rows[0]) : null
    } catch (err) {
      this.record('FOIS/01', err instanceof UlipError ? err.code : 502, started, 0, false)
      throw err
    }
  }

  /**
   * One bill of entry.
   *
   * `boeFound` is not optional: an unknown BE comes back as an empty
   * `boeDetails` with `responseStatus: "SUCCESS"`, so isNotFound alone
   * would report a miss as a hit.
   */
  async billOfEntry(beNo: string, beDt: string): Promise<LiveBoe | null> {
    const started = performance.now()
    try {
      const env = await this.client.callRaw<{ boeDetails?: BoeRecord[] }>('ICEGATE/02', { beNo, beDt })
      if (isNotFound(env)) { this.record('ICEGATE/02', 200, started, 0, false); return null }
      const details = flatten(env).flatMap((r) => r.boeDetails ?? [])
      this.record('ICEGATE/02', 200, started, JSON.stringify(env).length, boeFound(details))
      return boeFound(details) ? toBoe(details[0]) : null
    } catch (err) {
      this.record('ICEGATE/02', err instanceof UlipError ? err.code : 502, started, 0, false)
      throw err
    }
  }

  async apiCatalogue(): Promise<CatalogueEntry[]> {
    // Subscription state belongs to your approved account; until the
    // gateway exposes it, every endpoint is listed as un-subscribed
    // rather than guessed at.
    return ULIP_ENDPOINTS.map((ep) => ({
      ...ep, subscribed: false, avgLatencyMs: 0, successPct: 0, quota: 0, used: 0,
    }))
  }

  async apiLogs(): Promise<ApiCall[]> { return [...this.log] }

  async invokeApi(endpointId: string, params: Record<string, string>) {
    const started = performance.now()
    const requestPreview = JSON.stringify(params, null, 2)
    try {
      const body = await this.client.callRaw<unknown>(endpointId, params)
      const text = JSON.stringify(body)
      this.record(endpointId, 200, started, text.length, !isNotFound(body))
      return { status: 200, latencyMs: Math.round(performance.now() - started), body, requestPreview }
    } catch (err) {
      const status = err instanceof UlipError ? err.code : 502
      this.record(endpointId, status, started, 0, false)
      throw err
    }
  }

  async toggleSubscription(): Promise<CatalogueEntry> {
    return notWired('Changing a subscription',
      'Dataset approval happens on goulip.in against your account, not through the API.')
  }

  /* ── Everything that needs a consignment book ──────────────── */

  async listShipments(_q: ShipmentQuery): Promise<Page<Shipment>> { return notWired('Listing consignments') }
  async getShipment(_id: string): Promise<Shipment | null> { return notWired('Fetching a consignment by id') }
  async shipment360(_id: string): Promise<Fused360 | null> { return notWired('The 360 view') }
  async liveMap() { return notWired('The live map') }
  async dashboard(): Promise<Dashboard> { return notWired('The dashboard') }
  async signals() { return notWired('Cross-system signals') }
  async signalQuality() { return notWired('Detector precision') }
  async listVehicles(_q: VehicleQuery): Promise<Page<Vehicle>> {
    return notWired('Listing the fleet',
      'VAHAN answers for one registration at a time. The roster has to come from your own '
      + 'records; each vehicle in it can then be looked up.')
  }
  async listDocs(_q: DocQuery): Promise<Page<ComplianceDoc>> { return notWired('Listing documents') }
  async docsFor(_linkedTo: string): Promise<ComplianceDoc[]> { return notWired('Documents for a consignment') }
  async listExceptions(): Promise<Exception[]> { return notWired('Exceptions') }
  async acknowledgeException(): Promise<void> { return notWired('Acknowledging an exception') }
  async eximFiles() { return notWired('EXIM files') }
  async getEximFile() { return notWired('An EXIM file') }
  async counterparties() { return notWired('Counterparty due diligence') }
  async getCounterparty() { return notWired('A counterparty') }
  async planLane() { return notWired('Lane planning') }
  async runScenario() { return notWired('Scenario drill') }
  async waterways() { return notWired('Waterways') }
  async gatiShakti() { return notWired('The GatiShakti layer') }

  /* ── Case work needs signals, and signals need the book ────── */

  async listCases(_q?: CaseQuery) { return notWired('The decisions queue') }
  async getCase() { return notWired('A case') }
  async assignCase() { return notWired('Assigning a case') }
  async setCaseStatus() { return notWired('Changing case status') }
  async snoozeCase() { return notWired('Snoozing a case') }
  async resolveCase() { return notWired('Resolving a case') }
  async dismissCase() { return notWired('Dismissing a case') }
  async reopenCase() { return notWired('Reopening a case') }
  async addCaseNote() { return notWired('Adding a case note') }
  async caseStoreKind(): Promise<'server' | 'local'> { return 'server' }
  async deliveryTarget() { return { configured: false, label: null } }
  async deliverCases() {
    return notWired('Delivery',
      'It sends cases, and cases need signals, which need the consignment book.') as never
  }

  /* ── Open-source context is not ULIP and is unaffected ─────── */

  async ncrAirQuality() { return notWired('Air quality', 'Wire this to the OSINT module, not the gateway.') }
  async corridorWeather() { return notWired('Corridor weather', 'Wire this to the OSINT module, not the gateway.') }
  async disruptions() { return notWired('Disruption feed', 'Needs the proxy OSINT route.') }
  async vessels() { return notWired('Vessel positions', 'Needs the proxy OSINT route.') }
}

/** The envelope nests records one level deeper than you expect. */
function flatten<T>(env: UlipEnvelope<T>): T[] {
  const out: T[] = []
  for (const r of env.response ?? []) {
    const inner = (r as { response?: unknown }).response
    if (Array.isArray(inner)) out.push(...(inner as T[]))
    else if (inner && typeof inner === 'object') {
      const data = (inner as { data?: unknown }).data
      if (Array.isArray(data)) out.push(...(data as T[]))
      else out.push(inner as T)
    }
  }
  return out
}
