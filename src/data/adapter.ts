import type {
  ApiCall, ComplianceDoc, DocStatus, Exception,
  Shipment, ShipmentStatus, Vehicle,
} from './types'
import type { CatalogueEntry } from './mock/gateway'
import type { UlipEnvelope } from './ulip/envelope'
import type { Coverage, Signal, SignalKind } from './fusion'
import type { Case, CaseStatus, Resolution } from './cases'
import type { LanePlan } from './routes'
import type { AirQuality, CorridorWeather } from './osint'
import type { DisruptionFeed } from './disruptions'
import type { PortTraffic, VesselFeed } from './vessels'
import type { ScenarioResult, ScenarioSpec } from './scenarios'
import type { Counterparty } from './counterparty'
import type { EximFile } from './exim'
import type { Waterway } from './waterways'
import type { GatiShaktiLayer } from './gatishakti'

export interface Page<T> { rows: T[]; total: number }

export interface ShipmentQuery {
  search?: string
  status?: ShipmentStatus | 'all'
  mode?: string
  origin?: string
  destination?: string
  onlyDelayed?: boolean
  /**
   * Only consignments carrying a live signal of one of these kinds. Empty or
   * absent means no signal filter. Role-agnostic on purpose — the lens
   * decides which kinds matter, the adapter only knows how to filter.
   */
  signalKinds?: readonly SignalKind[]
  sort?: 'eta' | 'created' | 'delay' | 'value'
  page?: number
  pageSize?: number
}

export interface VehicleQuery {
  search?: string
  status?: Vehicle['status'] | 'all'
  compliance?: 'all' | 'issues'
  page?: number
  pageSize?: number
}

export interface DocQuery {
  search?: string
  type?: string
  status?: DocStatus | 'all'
  page?: number
  pageSize?: number
}

/** One consignment seen through every source system at once. */
export interface Fused360 {
  shipment: Shipment
  vehicle: Vehicle | null
  docs: ComplianceDoc[]
  signals: Signal[]
  coverage: Coverage[]
  risk: number
  confidence: number
}

export interface CaseQuery {
  /** 'live' hides resolved and dismissed, and snoozes that have not lapsed. */
  scope?: 'live' | 'all' | 'mine' | 'unassigned' | 'overdue' | 'resolved'
  severity?: 'critical' | 'high' | 'medium' | 'all'
  assignee?: string
  search?: string
}

export interface Dashboard {
  activeShipments: number
  inTransitValue: number
  onTimePct: number
  avgDelayHrs: number
  openExceptions: number
  /** Consignment value exposed to LIVE critical/high signals (resolved excluded). */
  valueAtRisk: number
  criticalSignals: number
  /** Live cases with no owner — the queue nobody has picked up. */
  unassignedCases: number
  /** Live cases past the SLA for their severity. */
  overdueCases: number
  resolvedToday: number
  /** Mean share of relevant source systems reporting per consignment. */
  dataConfidence: number
  fleetActive: number
  fleetTotal: number
  utilisationPct: number
  docCompliancePct: number
  docsExpiring: number
  apiCallsToday: number
  apiSuccessPct: number
  co2Tonnes: number
  detentionHrs: number
  daily: ReturnType<typeof import('./mock/generate').makeDailySeries>
  modal: ReturnType<typeof import('./mock/generate').makeModalSplit>
  topLanes: Array<{ lane: string; count: number; onTimePct: number; avgHrs: number }>
  sourceHealth: Array<{ system: string; uptimePct: number; latencyMs: number; calls: number }>
}

/**
 * Every screen talks to this interface and nothing else. The mock
 * implementation ships with the app; a real implementation that calls the
 * ULIP gateway (via your own server-side proxy, so credentials never reach
 * the browser) can be swapped in at `src/data/index.ts` without touching a
 * single component.
 */
export interface DataAdapter {
  readonly id: string
  readonly label: string
  readonly live: boolean

  listShipments(q: ShipmentQuery): Promise<Page<Shipment>>
  getShipment(id: string): Promise<Shipment | null>

  listVehicles(q: VehicleQuery): Promise<Page<Vehicle>>
  getVehicle(regNo: string): Promise<Vehicle | null>

  listDocs(q: DocQuery): Promise<Page<ComplianceDoc>>
  docsFor(linkedTo: string): Promise<ComplianceDoc[]>

  listExceptions(): Promise<Exception[]>
  acknowledgeException(id: string): Promise<void>

  /** Network-wide cross-system signals, ranked by severity then exposure. */
  signals(): Promise<Signal[]>

  /**
   * Live open-source context: NCR air quality and the GRAP stage it implies.
   * Returns null when the network is unavailable — every caller degrades
   * rather than failing.
   */
  ncrAirQuality(): Promise<AirQuality | null>
  corridorWeather(origin: string, destination: string): Promise<CorridorWeather[]>
  /** Filtered, de-duplicated disruption news affecting logistics nodes. */
  disruptions(): Promise<DisruptionFeed>
  /** AIS vessel positions, plus per-port congestion rolled up from them. */
  vessels(): Promise<VesselFeed & { ports: PortTraffic[] }>

  /* ── Case work ───────────────────────────────────────────────
     Signals are derived and recomputed; cases are the human record
     over them — owner, status, outcome, and an audit trail. */
  listCases(q?: CaseQuery): Promise<Case[]>
  getCase(signalId: string): Promise<Case | null>
  assignCase(signalId: string, memberId: string | null, actor: string): Promise<Case>
  setCaseStatus(signalId: string, status: CaseStatus, actor: string): Promise<Case>
  snoozeCase(signalId: string, hours: number, actor: string): Promise<Case>
  resolveCase(
    signalId: string, resolution: Resolution, note: string, actor: string,
  ): Promise<Case>
  dismissCase(signalId: string, note: string, actor: string): Promise<Case>
  reopenCase(signalId: string, actor: string): Promise<Case>
  addCaseNote(signalId: string, note: string, actor: string): Promise<Case>
  /** 'server' when the queue is shared across operators, 'local' when not. */
  caseStoreKind(): Promise<'server' | 'local'>
  /** Everything every subscribed system knows about one consignment. */
  shipment360(id: string): Promise<Fused360 | null>

  dashboard(): Promise<Dashboard>
  liveMap(): Promise<Array<Pick<Shipment, 'id' | 'lat' | 'lon' | 'status' | 'origin' | 'destination' | 'progress' | 'delayMins'>>>

  /**
   * Plan a lane before it is booked — safety, restrictions, cost and the
   * modal trade-off, from the catalogue's planning-side datasets.
   */
  planLane(origin: string, destination: string, opts: {
    weightKg: number; departAt: Date; vehicleClass: string
  }): Promise<LanePlan>

  /** Cost a hypothetical disruption against the network as it stands now. */
  runScenario(spec: ScenarioSpec): Promise<ScenarioResult>

  /** National Waterways, their stretches, structures and terminals. */
  waterways(): Promise<Waterway[]>

  /**
   * The infrastructure the network runs on — corridors and their lane
   * status, toll plazas, industrial parks, warehousing. A map layer
   * rather than a screen: a corridor only means something next to the
   * consignments using it.
   */
  gatiShakti(): Promise<GatiShaktiLayer>

  /** Import and export clearance files, with their demurrage clocks. */
  eximFiles(q?: { direction?: 'import' | 'export' | 'all'; search?: string; onlyOpen?: boolean }):
    Promise<EximFile[]>
  getEximFile(id: string): Promise<EximFile | null>

  /** Due diligence on the parties this network actually trades with. */
  counterparties(search?: string): Promise<Counterparty[]>
  getCounterparty(id: string): Promise<Counterparty | null>

  apiCatalogue(): Promise<CatalogueEntry[]>
  apiLogs(): Promise<ApiCall[]>
  toggleSubscription(endpointId: string): Promise<CatalogueEntry>
  /**
   * Execute a catalogue endpoint. Mirrors the documented ULIP contract:
   * the body is always an envelope, and a 200 may still carry inner errors.
   */
  invokeApi(endpointId: string, params: Record<string, string>): Promise<{
    status: number
    latencyMs: number
    body: UlipEnvelope<unknown>
    requestPreview: string
  }>
}
