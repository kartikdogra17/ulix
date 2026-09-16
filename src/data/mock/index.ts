import type {
  CaseQuery, DataAdapter, Dashboard, DocQuery, Fused360, Page, ShipmentQuery, VehicleQuery,
} from '../adapter'
import {
  type Case, type CaseRecord, type CaseStatus, type Resolution,
  RESOLUTION_LABEL, appendActivity, blankCase, isLive, isOverdue, memberById,
} from '../cases'
import { type CaseStore, type StoredCase, caseStore } from '../caseStore'
import {
  type Signal, confidence, coverageForShipment, riskScore, signalsForShipment,
} from '../fusion'
import type { ApiCall, ComplianceDoc, Exception, Shipment, Vehicle } from '../types'
import { type CatalogueEntry, makeApiCalls, makeCatalogue } from './gateway'
import { FASTAG_RETENTION_HOURS, ULIP_BASE } from '../ulip/catalogue'
import { UlipClient } from '../ulip/client'
import { type UlipEnvelope, envelope, errorEnvelope, notFoundEnvelope } from '../ulip/envelope'
import {
  NOW, makeDailySeries, makeDocs, makeExceptions, makeModalSplit, makeShipments, makeVehicles,
} from './generate'
import { NODE_BY_CODE } from './seed'
import { planLane } from '../routes'
import { type AirQuality, fetchAirQuality, fetchCorridorWeather } from '../osint'
import { type DisruptionFeed, fetchDisruptions } from '../disruptions'
import { fetchVessels, portTraffic } from '../vessels'
import { type ScenarioSpec, runScenario } from '../scenarios'
import { makeCounterparties } from '../counterparty'
import { makeEximFiles } from '../exim'
import { makeWaterways } from '../waterways'
import { makeGatiShakti } from '../gatishakti'

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
/** Simulated gateway latency so loading states are real, not theatre. */
const latency = () => 90 + Math.random() * 220

function paginate<T>(rows: T[], page = 1, pageSize = 25): Page<T> {
  const start = (page - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), total: rows.length }
}

export class MockAdapter implements DataAdapter {
  readonly id = 'mock'
  readonly label = 'Simulated ULIP gateway'
  readonly live = false

  private shipments = makeShipments()
  private vehicles = makeVehicles(this.shipments)
  private docs = makeDocs(this.shipments, this.vehicles)
  private exceptions = makeExceptions(this.shipments, this.vehicles, this.docs)
  private endpoints: CatalogueEntry[] = makeCatalogue()
  private calls: ApiCall[] = makeApiCalls(this.endpoints)
  private daily = makeDailySeries()
  private modal = makeModalSplit()
  private signalCache: Signal[] | null = null
  /** Live OSINT context, refreshed out of band and folded into fusion. */
  private ncrAir: AirQuality | null = null
  private airLoaded: Promise<void> | null = null
  private disruptionFeed: DisruptionFeed | null = null
  private disruptionsLoaded: Promise<void> | null = null
  /** signalId -> { record, version }, mirroring whichever store is in use. */
  private cases: Record<string, StoredCase> = {}
  private store: CaseStore | null = null
  private casesLoaded: Promise<void> | null = null

  /* ── Case work ─────────────────────────────────────────────── */

  /** Load the shared queue once per session, falling back to local storage. */
  private async ensureCases() {
    if (!this.casesLoaded) {
      this.casesLoaded = (async () => {
        this.store = await caseStore()
        try { this.cases = await this.store.load() } catch { this.cases = {} }
      })()
    }
    return this.casesLoaded
  }

  /** Materialise a case for a signal, creating one lazily on first sight. */
  private caseFor(signal: Signal, now = Date.now()): Case {
    const rec = this.cases[signal.id]?.record
      ?? blankCase(signal.id, signal.detectedAt, now)
    return {
      ...rec,
      signal,
      isDue: rec.status === 'snoozed'
        ? !rec.snoozedUntil || Date.parse(rec.snoozedUntil) <= now
        : false,
    }
  }

  private allCases(): Case[] {
    const now = Date.now()
    return this.allSignals().map((s) => this.caseFor(s, now))
  }

  /**
   * Apply a change and push it to the store. On a version conflict the write
   * is reapplied over whatever a colleague landed first, rather than
   * overwriting their work — that is the point of a shared queue.
   */
  private async mutate(
    signalId: string, fn: (rec: CaseRecord) => CaseRecord,
  ): Promise<Case> {
    await this.ensureCases()
    const signal = this.allSignals().find((s) => s.id === signalId)
    if (!signal) throw new Error(`Unknown signal ${signalId}`)

    const apply = async (base: StoredCase | undefined): Promise<Case> => {
      const record = fn(base?.record ?? blankCase(signalId, signal.detectedAt))
      const version = base?.version ?? 0
      const result = await this.store!.save(signalId, record, version)

      if (!result.ok && result.current) {
        // Someone else wrote first. Reapply on top of theirs, once.
        const merged = fn(result.current.record)
        await this.store!.save(signalId, merged, result.current.version)
        this.cases = { ...this.cases, [signalId]: { record: merged, version: result.current.version + 1 } }
      } else {
        this.cases = { ...this.cases, [signalId]: { record, version: version + 1 } }
      }
      return this.caseFor(signal)
    }

    return apply(this.cases[signalId])
  }

  /** Which store the session ended up on, for the UI to be honest about. */
  async caseStoreKind() {
    await this.ensureCases()
    return this.store?.kind ?? 'local'
  }

  /** The vehicle currently under a consignment, via its active road leg. */
  private vehicleFor(shipmentId: string) {
    return this.vehicles.find((v) => v.shipmentId === shipmentId) ?? null
  }

  private subscribedSet() {
    return new Set(this.endpoints.filter((e) => e.subscribed).map((e) => e.id))
  }

  /** Fetch NCR air once per session; fusion runs with or without it. */
  private async ensureAir() {
    if (!this.airLoaded) {
      this.airLoaded = fetchAirQuality(28.61, 77.21).then((a) => {
        this.ncrAir = a
        // Air quality changes the signal set, so drop the derived cache.
        if (a) this.signalCache = null
      })
    }
    return this.airLoaded
  }

  /** Disruption news is fetched once per session and folded into fusion. */
  private async ensureDisruptions() {
    if (!this.disruptionsLoaded) {
      this.disruptionsLoaded = fetchDisruptions().then((f) => {
        this.disruptionFeed = f
        if (f.items.length) this.signalCache = null
      })
    }
    return this.disruptionsLoaded
  }

  private allSignals(): Signal[] {
    const nodeAt = (code: string) => {
      const n = NODE_BY_CODE[code]
      return n ? { lat: n.lat, lon: n.lon } : undefined
    }
    if (this.signalCache) return this.signalCache
    const byShipment = new Map<string, typeof this.docs>()
    for (const d of this.docs) {
      if (d.linkedKind !== 'shipment') continue
      const list = byShipment.get(d.linkedTo) ?? []
      list.push(d)
      byShipment.set(d.linkedTo, list)
    }
    this.signalCache = this.shipments
      .flatMap((s) => signalsForShipment(
        s, this.vehicleFor(s.id), byShipment.get(s.id) ?? [], Date.now(),
        {
          ncrAir: this.ncrAir,
          disruptions: this.disruptionFeed?.items ?? [],
          corridors: this.gs.corridors,
          // fusion.ts holds no node table of its own, so the geography is
          // resolved here where it already lives.
          nodeAt,
        }))
      .sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2 } as const
        return rank[a.severity] - rank[b.severity] || b.valueAtRisk - a.valueAtRisk
      })
    return this.signalCache
  }

  /* ── Shipments ─────────────────────────────────────────────── */

  async listShipments(q: ShipmentQuery): Promise<Page<Shipment>> {
    await sleep(latency())
    const term = q.search?.trim().toLowerCase()
    /* allSignals() is cached, so this is a Set build rather than a re-derive. */
    const flagged = q.signalKinds?.length
      ? new Set(this.allSignals()
          .filter((sig) => (q.signalKinds as readonly string[]).includes(sig.kind))
          .map((sig) => sig.entity))
      : null
    let rows = this.shipments.filter((s) => {
      if (flagged && !flagged.has(s.id)) return false
      if (q.status && q.status !== 'all' && s.status !== q.status) return false
      if (q.mode && q.mode !== 'all' && !s.legs.some((l) => l.mode === q.mode)) return false
      if (q.origin && q.origin !== 'all' && s.origin !== q.origin) return false
      if (q.destination && q.destination !== 'all' && s.destination !== q.destination) return false
      if (q.onlyDelayed && s.delayMins <= 30) return false
      if (term) {
        const hay = [
          s.id, s.ulipRef, s.consignor, s.consignee, s.commodity, s.ewayBill,
          NODE_BY_CODE[s.origin]?.name, NODE_BY_CODE[s.destination]?.name,
          ...s.legs.map((l) => l.conveyance),
        ].join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })

    const sorters: Record<string, (a: Shipment, b: Shipment) => number> = {
      eta: (a, b) => Date.parse(a.eta) - Date.parse(b.eta),
      created: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      delay: (a, b) => b.delayMins - a.delayMins,
      value: (a, b) => b.invoiceValue - a.invoiceValue,
    }
    rows = [...rows].sort(sorters[q.sort ?? 'created'])
    return paginate(rows, q.page, q.pageSize)
  }

  async getShipment(id: string) {
    await sleep(latency())
    return this.shipments.find((s) => s.id === id || s.ulipRef === id) ?? null
  }

  /* ── Fleet ─────────────────────────────────────────────────── */

  private hasComplianceIssue(v: Vehicle) {
    return v.rcStatus !== 'ACTIVE'
      || v.tagStatus !== 'ACTIVE'
      || Date.parse(v.fitnessUpto) < NOW
      || Date.parse(v.insuranceUpto) < NOW
      || Date.parse(v.pucUpto) < NOW
      || Date.parse(v.permitUpto) < NOW
      || Date.parse(v.dlValidUpto) < NOW
  }

  async listVehicles(q: VehicleQuery): Promise<Page<Vehicle>> {
    await sleep(latency())
    const term = q.search?.trim().toLowerCase()
    const rows = this.vehicles.filter((v) => {
      if (q.status && q.status !== 'all' && v.status !== q.status) return false
      if (q.compliance === 'issues' && !this.hasComplianceIssue(v)) return false
      if (term) {
        const hay = [v.regNo, v.driverName, v.owner, v.makeModel, v.tagId, v.shipmentId ?? '']
          .join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    return paginate(rows, q.page, q.pageSize)
  }

  async getVehicle(regNo: string) {
    await sleep(latency())
    return this.vehicles.find((v) => v.regNo === regNo) ?? null
  }

  /* ── Compliance ────────────────────────────────────────────── */

  async listDocs(q: DocQuery): Promise<Page<ComplianceDoc>> {
    await sleep(latency())
    const term = q.search?.trim().toLowerCase()
    const rank: Record<string, number> = { mismatch: 0, expired: 1, expiring: 2, pending: 3, valid: 4 }
    const rows = this.docs
      .filter((d) => {
        if (q.type && q.type !== 'all' && d.type !== q.type) return false
        if (q.status && q.status !== 'all' && d.status !== q.status) return false
        if (term && ![d.number, d.linkedTo, d.issuer, d.type].join(' ').toLowerCase().includes(term)) return false
        return true
      })
      .sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(a.validUpto) - Date.parse(b.validUpto))
    return paginate(rows, q.page, q.pageSize)
  }

  async docsFor(linkedTo: string) {
    await sleep(latency() / 2)
    return this.docs.filter((d) => d.linkedTo === linkedTo)
  }

  /* ── Exceptions ────────────────────────────────────────────── */

  async listExceptions(): Promise<Exception[]> {
    await sleep(latency())
    return this.exceptions
  }

  async acknowledgeException(id: string) {
    await sleep(120)
    this.exceptions = this.exceptions.map((e) => (e.id === id ? { ...e, ack: true } : e))
  }

  /* ── Cross-system fusion ───────────────────────────────────── */

  async signals() {
    await Promise.all([sleep(latency()), this.ensureAir(), this.ensureDisruptions()])
    return this.allSignals()
  }

  async disruptions() {
    // Served from the session fetch — hitting the proxy twice for one screen
    // was costing a visible second of skeleton on every dashboard load.
    await this.ensureDisruptions()
    return this.disruptionFeed ?? { items: [], live: false, fetchedAt: null }
  }

  async vessels() {
    const feed = await fetchVessels()
    return { ...feed, ports: portTraffic(feed.vessels) }
  }

  async ncrAirQuality() {
    await this.ensureAir()
    return this.ncrAir
  }

  async corridorWeather(origin: string, destination: string) {
    const a = NODE_BY_CODE[origin], b = NODE_BY_CODE[destination]
    if (!a || !b) return []
    return fetchCorridorWeather(a, b, 3)
  }

  async listCases(q: CaseQuery = {}): Promise<Case[]> {
    await Promise.all([
      sleep(latency()), this.ensureAir(), this.ensureDisruptions(), this.ensureCases(),
    ])
    const scope = q.scope ?? 'live'
    const term = q.search?.trim().toLowerCase()
    return this.allCases().filter((c) => {
      if (q.severity && q.severity !== 'all' && c.signal.severity !== q.severity) return false
      if (q.assignee && c.assignee !== q.assignee) return false
      if (term && ![c.signal.title, c.signal.entity, c.signal.detail, ...c.signal.sources]
        .join(' ').toLowerCase().includes(term)) return false

      switch (scope) {
        case 'all': return true
        case 'resolved': return c.status === 'resolved' || c.status === 'dismissed'
        case 'mine': return isLive(c) && c.assignee === q.assignee
        case 'unassigned': return isLive(c) && !c.assignee
        case 'overdue': return isOverdue(c)
        default: return isLive(c)
      }
    })
  }

  async getCase(signalId: string) {
    await Promise.all([sleep(latency() / 2), this.ensureCases()])
    const signal = this.allSignals().find((s) => s.id === signalId)
    return signal ? this.caseFor(signal) : null
  }

  async assignCase(signalId: string, memberId: string | null, actor: string) {
    await sleep(160)
    return await this.mutate(signalId, (rec) => {
      const who = memberById(memberId)
      const next = appendActivity(
        { ...rec, assignee: memberId },
        actor,
        memberId ? 'assigned' : 'unassigned',
        memberId ? `Assigned to ${who?.name ?? memberId}` : 'Owner removed',
      )
      // Picking up an untouched case starts the clock on it.
      return next.status === 'open' && memberId ? { ...next, status: 'in_progress' } : next
    })
  }

  async setCaseStatus(signalId: string, status: CaseStatus, actor: string) {
    await sleep(160)
    return await this.mutate(signalId, (rec) =>
      appendActivity({ ...rec, status, snoozedUntil: null }, actor, 'status',
        `Status changed to ${status.replace('_', ' ')}`))
  }

  async snoozeCase(signalId: string, hours: number, actor: string) {
    await sleep(160)
    const until = new Date(Date.now() + hours * 3_600_000).toISOString()
    return await this.mutate(signalId, (rec) =>
      appendActivity({ ...rec, status: 'snoozed', snoozedUntil: until }, actor, 'snoozed',
        `Snoozed for ${hours}h — back in the queue ${new Date(until).toLocaleString('en-IN')}`))
  }

  async resolveCase(signalId: string, resolution: Resolution, note: string, actor: string) {
    await sleep(200)
    return await this.mutate(signalId, (rec) =>
      appendActivity(
        { ...rec, status: 'resolved', resolution, snoozedUntil: null }, actor, 'resolved',
        `${RESOLUTION_LABEL[resolution]}${note.trim() ? ` — ${note.trim()}` : ''}`))
  }

  async dismissCase(signalId: string, note: string, actor: string) {
    await sleep(160)
    return await this.mutate(signalId, (rec) =>
      appendActivity(
        { ...rec, status: 'dismissed', resolution: 'false_positive', snoozedUntil: null },
        actor, 'dismissed',
        `Dismissed${note.trim() ? ` — ${note.trim()}` : ''}`))
  }

  async reopenCase(signalId: string, actor: string) {
    await sleep(160)
    return await this.mutate(signalId, (rec) =>
      appendActivity(
        { ...rec, status: 'in_progress', resolution: null, snoozedUntil: null },
        actor, 'reopened', 'Reopened'))
  }

  async addCaseNote(signalId: string, note: string, actor: string) {
    await sleep(140)
    return await this.mutate(signalId, (rec) =>
      appendActivity(rec, actor, 'note', note.trim()))
  }

  async shipment360(id: string): Promise<Fused360 | null> {
    await sleep(latency())
    const shipment = this.shipments.find((s) => s.id === id || s.ulipRef === id)
    if (!shipment) return null
    const vehicle = this.vehicleFor(shipment.id)
    const docs = this.docs.filter((d) => d.linkedTo === shipment.id)
    const signals = signalsForShipment(shipment, vehicle, docs)
    const coverage = coverageForShipment(shipment, vehicle, docs, this.subscribedSet())
    return {
      shipment, vehicle, docs, signals, coverage,
      risk: riskScore(signals),
      confidence: confidence(coverage),
    }
  }

  /* ── Dashboard ─────────────────────────────────────────────── */

  async dashboard(): Promise<Dashboard> {
    await Promise.all([
      sleep(latency()), this.ensureAir(), this.ensureDisruptions(), this.ensureCases(),
    ])
    const active = this.shipments.filter((s) => s.status !== 'delivered' && s.status !== 'planned')
    const done = this.shipments.filter((s) => s.status === 'delivered')
    const onTime = done.filter((s) => s.delayMins <= 30).length
    const delayed = active.filter((s) => s.delayMins > 30)
    const activeVehicles = this.vehicles.filter((v) => v.status === 'moving' || v.status === 'loading')
    const badDocs = this.docs.filter((d) => d.status === 'expired' || d.status === 'mismatch')
    const expiring = this.docs.filter((d) => d.status === 'expiring')
    const today = this.calls.filter((c) => Date.parse(c.ts) > NOW - 86_400_000)
    const cases = this.allCases()
    const liveCases = cases.filter(isLive)
    const signals = liveCases.map((c) => c.signal)
    const subs = this.subscribedSet()
    // Coverage is expensive per consignment; a sample is enough for a mean.
    const sampled = active.slice(0, 40)

    const laneMap = new Map<string, { count: number; onTime: number; hrs: number }>()
    for (const s of this.shipments) {
      const key = `${s.origin}→${s.destination}`
      const agg = laneMap.get(key) ?? { count: 0, onTime: 0, hrs: 0 }
      agg.count++
      if (s.delayMins <= 30) agg.onTime++
      agg.hrs += (Date.parse(s.eta) - Date.parse(s.createdAt)) / 3_600_000
      laneMap.set(key, agg)
    }
    const topLanes = [...laneMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([lane, a]) => ({
        lane: `${NODE_BY_CODE[lane.split('→')[0]].name} → ${NODE_BY_CODE[lane.split('→')[1]].name}`,
        count: a.count,
        onTimePct: +((a.onTime / a.count) * 100).toFixed(0),
        avgHrs: +(a.hrs / a.count).toFixed(1),
      }))

    const sourceHealth = ['FASTag', 'VAHAN', 'eWayBill', 'FOIS', 'ICEGATE', 'PCS', 'AirCargo', 'SARATHI']
      .map((system) => {
        const eps = this.endpoints.filter((e) => e.system === system)
        const calls = this.calls.filter((c) => eps.some((e) => e.id === c.endpointId)).length
        return {
          system,
          uptimePct: eps.length ? +(eps.reduce((a, e) => a + e.successPct, 0) / eps.length).toFixed(1) : 99,
          latencyMs: eps.length ? Math.round(eps.reduce((a, e) => a + e.avgLatencyMs, 0) / eps.length) : 300,
          calls,
        }
      })

    return {
      activeShipments: active.length,
      inTransitValue: active.reduce((a, s) => a + s.invoiceValue, 0),
      onTimePct: +((onTime / Math.max(1, done.length)) * 100).toFixed(1),
      avgDelayHrs: +(delayed.reduce((a, s) => a + s.delayMins, 0) / Math.max(1, delayed.length) / 60).toFixed(1),
      openExceptions: this.exceptions.filter((e) => !e.ack).length,
      // Exposure counts each consignment once, and only while its case is
      // still live — resolving a case should visibly move this number.
      valueAtRisk: [...new Map(
        signals.filter((g) => g.severity !== 'medium').map((g) => [g.entity, g.valueAtRisk]),
      ).values()].reduce((a, v) => a + v, 0),
      criticalSignals: signals.filter((g) => g.severity === 'critical').length,
      unassignedCases: liveCases.filter((c) => !c.assignee).length,
      overdueCases: liveCases.filter((c) => isOverdue(c)).length,
      resolvedToday: cases.filter((c) =>
        (c.status === 'resolved' || c.status === 'dismissed')
        && Date.parse(c.updatedAt) > Date.now() - 86_400_000).length,
      dataConfidence: Math.round(
        sampled.reduce((a, s) => a + confidence(
          coverageForShipment(s, this.vehicleFor(s.id),
            this.docs.filter((d) => d.linkedTo === s.id), subs)), 0) / Math.max(1, sampled.length)),
      fleetActive: activeVehicles.length,
      fleetTotal: this.vehicles.length,
      utilisationPct: Math.round(this.vehicles.reduce((a, v) => a + v.utilisationPct, 0) / this.vehicles.length),
      docCompliancePct: +(((this.docs.length - badDocs.length) / this.docs.length) * 100).toFixed(1),
      docsExpiring: expiring.length,
      apiCallsToday: today.length * 137,
      apiSuccessPct: +((today.filter((c) => c.status === 200).length / Math.max(1, today.length)) * 100).toFixed(1),
      co2Tonnes: +(this.shipments.reduce((a, s) => a + s.co2Kg, 0) / 1000).toFixed(1),
      detentionHrs: +(this.vehicles.reduce((a, v) => a + v.detentionHrs, 0) / this.vehicles.length).toFixed(1),
      daily: this.daily,
      modal: this.modal,
      topLanes,
      sourceHealth,
    }
  }

  async liveMap() {
    await sleep(latency() / 2)
    return this.shipments
      .filter((s) => s.status !== 'planned')
      .map(({ id, lat, lon, status, origin, destination, progress, delayMins }) =>
        ({ id, lat, lon, status, origin, destination, progress, delayMins }))
  }

  /* ── Lane planning ─────────────────────────────────────────── */

  async planLane(
    origin: string, destination: string,
    opts: { weightKg: number; departAt: Date; vehicleClass: string },
  ) {
    // Several source systems answer here, so the wait is deliberately longer.
    await sleep(latency() * 2.2)
    return planLane(origin, destination, opts)
  }

  /* ── Waterways ─────────────────────────────────────────────── */

  private nw = makeWaterways()
  private gs = makeGatiShakti()

  async waterways() {
    await sleep(latency())
    return this.nw
  }

  async gatiShakti() {
    await sleep(latency())
    return this.gs
  }

  /* ── EXIM ──────────────────────────────────────────────────── */

  private exim = makeEximFiles(this.shipments)

  async eximFiles(q: { direction?: 'import' | 'export' | 'all'; search?: string; onlyOpen?: boolean } = {}) {
    await sleep(latency())
    const term = q.search?.trim().toLowerCase()
    return this.exim.filter((f) => {
      if (q.direction && q.direction !== 'all' && f.direction !== q.direction) return false
      if (q.onlyOpen && f.cleared) return false
      if (term) {
        const hay = [
          f.id, f.containerNumber, f.party, f.portName, f.chaNo,
          f.beNo, f.sbNo, f.igmNo, f.egmNo, f.mawbNumber, f.esealNumber, f.vesselName,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }

  async getEximFile(id: string) {
    await sleep(latency() / 2)
    return this.exim.find((f) => f.id === id) ?? null
  }

  /* ── Counterparties ────────────────────────────────────────── */

  private parties = makeCounterparties(this.shipments)

  async counterparties(search?: string) {
    await sleep(latency())
    const term = search?.trim().toLowerCase()
    if (!term) return this.parties
    return this.parties.filter((p) =>
      [p.name, p.cin, p.gstin, p.udyamNo ?? '', p.iecNumber ?? '', ...p.directors.map((d) => d.name)]
        .join(' ').toLowerCase().includes(term))
  }

  async getCounterparty(id: string) {
    await sleep(latency() / 2)
    return this.parties.find((p) => p.id === id) ?? null
  }

  /* ── Scenario drill ────────────────────────────────────────── */

  async runScenario(spec: ScenarioSpec) {
    await sleep(latency())
    return runScenario(spec, this.shipments, this.vehicles, this.docs)
  }

  /* ── API gateway console ───────────────────────────────────── */

  async apiCatalogue() {
    await sleep(latency())
    return this.endpoints
  }

  async apiLogs() {
    await sleep(latency())
    return this.calls
  }

  async toggleSubscription(endpointId: string) {
    await sleep(320)
    this.endpoints = this.endpoints.map((e) =>
      e.id === endpointId
        ? { ...e, subscribed: !e.subscribed, quota: e.subscribed ? 0 : 25000, used: 0 }
        : e)
    return this.endpoints.find((e) => e.id === endpointId)!
  }

  /**
   * Answer a try-it call the way the real gateway would: same envelope,
   * same status codes, same documented validation messages.
   */
  async invokeApi(endpointId: string, params: Record<string, string>) {
    const ep = this.endpoints.find((e) => e.id === endpointId)!
    const started = performance.now()
    await sleep(ep.avgLatencyMs * (0.6 + Math.random() * 0.9))
    const latencyMs = Math.round(performance.now() - started)

    const payload = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v?.trim() !== ''))
    const requestPreview = [
      `curl --location '${ULIP_BASE.production}/${ep.id}' \\`,
      `  --header 'Authorization: Bearer <token>' \\`,
      `  --header 'Content-Type: application/json' \\`,
      `  --header 'Accept: application/json' \\`,
      `  --data '${JSON.stringify(payload, null, 2)}'`,
    ].join('\n')

    const respond = (status: number, body: UlipEnvelope<unknown>, resolved: boolean) => {
      this.calls = [{
        id: `RQ-${Math.floor(Math.random() * 900000 + 100000)}`,
        ts: new Date().toISOString(), endpointId: ep.id, status, latencyMs,
        bytes: JSON.stringify(body).length, consumer: 'ops-console', resolved,
      }, ...this.calls]
      return { status, latencyMs, body, requestPreview }
    }

    if (!ep.subscribed) {
      return respond(403, errorEnvelope(403,
        `Your ULIP client is not subscribed to ${ep.id}. Raise a data request on the portal.`), false)
    }

    // Required-field check, then the documented regex validation.
    const missing = ep.params.filter((p) => !payload[p.name])
    if (missing.length) {
      return respond(400, errorEnvelope(400,
        `Data format failed OR wrong value entered at: ${missing[0].name}.` +
        (missing[0].format ? ` Format should follow ${missing[0].format}` : '')), false)
    }
    const invalid = UlipClient.validate(ep.id, payload)
    if (invalid) return respond(400, errorEnvelope(400, invalid), false)

    const record = this.resolve(ep.id, payload)
    if (record === null) return respond(200, notFoundEnvelope(), false)
    return respond(200, envelope([record]), true)
  }

  /**
   * Resolve a call against the simulated world, shaped like the real source
   * system's payload. Returns null when the record does not exist — which the
   * gateway reports as HTTP 200 with an inner ERROR, not as a 404.
   */
  private resolve(endpointId: string, p: Record<string, string>): unknown | null {
    const reg = (p.vehiclenumber ?? p.vehicleNumber ?? '').toUpperCase().replace(/\s/g, '')
    const v = this.vehicles.find((x) => x.regNo === reg)

    switch (endpointId) {
      case 'VAHAN/01':
      case 'VAHAN/04': {
        if (!v) return null
        return {
          rcRegnNo: v.regNo, rcOwnerName: v.owner, rcVhClassDesc: v.vehicleClass,
          rcMakerModel: v.makeModel, rcFuelDesc: v.fuel.toUpperCase(),
          rcNormsDesc: v.bsNorm,
          rcFitUpto: dmy(v.fitnessUpto), rcInsuranceUpto: dmy(v.insuranceUpto),
          rcPuccUpto: dmy(v.pucUpto), rcTaxUpto: dmy(v.permitUpto),
          rcStatus: v.rcStatus, rcBlacklistStatus: v.tagStatus === 'BLACKLIST' ? 'Y' : 'N',
          rcGvw: v.capacityKg, rcRegisteredAt: `RTO ${v.regNo.slice(0, 4)}`,
          rcInsuranceComp: 'New India Assurance', rcChasiNo: `MAT${v.regNo.slice(-6)}XXXXX`,
        }
      }
      case 'FASTAG/01':
      case 'FASTAG/02': {
        if (!v) return null
        // FASTAG/01 §1.3.1: only the last 72 hours are retained at source.
        const cutoff = NOW - FASTAG_RETENTION_HOURS * 3_600_000
        const txn = v.crossings
          .filter((c) => Date.parse(c.ts) >= cutoff)
          .map((c) => ({
            readerReadTime: c.ts.replace('T', ' ').slice(0, 19) + '.0',
            seqNo: c.id, laneDirection: c.direction,
            tollPlazaName: c.plaza, tollPlazaGeocode: `${c.lat},${c.lon}`,
            vehicleRegNo: v.regNo, tagId: v.tagId, amount: String(c.amount),
          }))
        return {
          result: 'SUCCESS', respCode: '000', ts: new Date().toISOString().slice(0, 19),
          vehicle: {
            errCode: '000',
            vehltxnList: {
              totalTagsInMsg: String(txn.length), msgNum: '1',
              totalTagsInresponse: String(txn.length), totalMsg: '1', txn,
            },
          },
        }
      }
      case 'EWAYBILL/01': {
        const s = this.shipments.find((x) => x.ewayBill === p.ewbNo?.trim())
        if (!s) return null
        const from = NODE_BY_CODE[s.origin], to = NODE_BY_CODE[s.destination]
        return {
          ewbNo: Number(s.ewayBill), ewayBillDate: dmyTime(s.createdAt),
          validUpto: dmyTime(s.promisedEta), fromPincode: pin(from.code), toPincode: pin(to.code),
          hsnCode: '', status: s.status === 'delivered' ? 'COM' : 'ACT',
          VehiclListDetails: s.legs.filter((l) => l.mode === 'road').map((l) => ({
            vehicleNo: l.conveyance, enteredDate: dmyTime(l.plannedDep), transMode: '1',
          })),
        }
      }
      case 'FOIS/01': {
        const s = this.shipments.find((x) => x.legs.some((l) => l.mode === 'rail'))
        if (!s) return null
        const leg = s.legs.find((l) => l.mode === 'rail')!
        return {
          fnrNumber: p.fnrnumber, rakeId: leg.conveyance,
          fromStation: leg.from, toStation: leg.to,
          currentStation: s.currentNode, status: leg.status.toUpperCase(),
          expectedPlacement: dmyTime(leg.plannedArr),
        }
      }
      case 'LDB/01':
        return {
          containerNumber: p.containerNumber, size: '40HC', status: 'DISCHARGED',
          terminal: 'NSIGT', vesselName: 'MV Bharat Star', voyage: '2634E',
          lastEvent: 'GATE_OUT', lastEventTime: dmyTime(new Date(NOW - 7200_000).toISOString()),
        }
      case 'ICEGATE/02':
        return {
          beNo: p.beNo, beDt: p.beDt, portCode: 'INNSA1', stage: 'OUT_OF_CHARGE',
          dutyPaid: 'Y', assessedValue: 4820000, oocDate: dmy(new Date(NOW - 86400000).toISOString()),
        }
      case 'CARBON/01': {
        const distance = Number(p.distance || 0), weight = Number(p.weight || 0)
        const trips = Number(p.tripCount || 1)
        return {
          distance, weight, tripCount: trips,
          emissionFactor: 0.09,
          totalCarbonEmitted: +(distance * (weight / 1000) * 0.09 * trips).toFixed(2),
          unit: 'kg CO2e',
        }
      }
      default:
        return { endpoint: endpointId, echo: p, note: 'Simulated response — no fixture for this dataset yet.' }
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dmy = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
const dmyTime = (iso: string) => {
  const d = new Date(iso)
  const h = d.getHours()
  return `${dmy(iso)} ${pad(h % 12 || 12)}:${pad(d.getMinutes())}:00 ${h < 12 ? 'AM' : 'PM'}`
}
/** Deterministic stand-in PIN code for a node. */
const pin = (code: string) =>
  100000 + ([...code].reduce((a, c) => a + c.charCodeAt(0), 0) * 977) % 800000
