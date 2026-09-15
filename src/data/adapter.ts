import type {
  ApiCall, ComplianceDoc, DocStatus, Exception,
  Shipment, ShipmentStatus, Vehicle,
} from './types'
import type { CatalogueEntry } from './mock/gateway'
import type { UlipEnvelope } from './ulip/envelope'
import type { Coverage, Signal } from './fusion'

export interface Page<T> { rows: T[]; total: number }

export interface ShipmentQuery {
  search?: string
  status?: ShipmentStatus | 'all'
  mode?: string
  origin?: string
  destination?: string
  onlyDelayed?: boolean
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

export interface Dashboard {
  activeShipments: number
  inTransitValue: number
  onTimePct: number
  avgDelayHrs: number
  openExceptions: number
  /** Consignment value exposed to unresolved critical/high signals. */
  valueAtRisk: number
  criticalSignals: number
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
  /** Everything every subscribed system knows about one consignment. */
  shipment360(id: string): Promise<Fused360 | null>

  dashboard(): Promise<Dashboard>
  liveMap(): Promise<Array<Pick<Shipment, 'id' | 'lat' | 'lon' | 'status' | 'origin' | 'destination' | 'progress' | 'delayMins'>>>

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
