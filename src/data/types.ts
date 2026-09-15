/* ──────────────────────────────────────────────────────────────
   ULIP domain model
   Entities mirror the shape of data the Unified Logistics
   Interface Platform aggregates from participating systems
   (FASTag/NHAI, VAHAN & SARATHI/MoRTH, e-Way Bill/GSTN,
   FOIS/Indian Railways, ICEGATE/CBIC, PCS/IPA, AAI air cargo).
   ────────────────────────────────────────────────────────────── */

export type Mode = 'road' | 'rail' | 'sea' | 'air'

export type SourceSystem =
  | 'FASTag' | 'VAHAN' | 'SARATHI' | 'eWayBill' | 'FOIS'
  | 'ICEGATE' | 'PCS' | 'AirCargo' | 'GSTN' | 'ULIP'

export type ShipmentStatus =
  | 'planned' | 'in_transit' | 'at_hub' | 'customs'
  | 'out_for_delivery' | 'delivered' | 'exception'

export type LegStatus = 'pending' | 'active' | 'completed' | 'delayed'

export interface Node {
  code: string
  name: string
  state: string
  lat: number
  lon: number
  kind: 'city' | 'port' | 'icd' | 'airport' | 'railhead' | 'warehouse'
}

export interface Leg {
  id: string
  mode: Mode
  carrier: string
  /** Vehicle reg / train no / vessel IMO / flight no depending on mode */
  conveyance: string
  from: string  // node code
  to: string    // node code
  plannedDep: string
  actualDep: string | null
  plannedArr: string
  actualArr: string | null
  status: LegStatus
  distanceKm: number
}

export interface TrackEvent {
  id: string
  ts: string
  code: string
  label: string
  source: SourceSystem
  location: string
  lat?: number
  lon?: number
  note?: string
}

export type ExceptionType =
  | 'delay' | 'detention' | 'route_deviation' | 'doc_mismatch'
  | 'temperature' | 'customs_hold' | 'tag_blacklist' | 'fitness_expiry'

export interface Exception {
  id: string
  type: ExceptionType
  severity: 'low' | 'medium' | 'high'
  raisedAt: string
  entity: string
  entityKind: 'shipment' | 'vehicle' | 'document'
  note: string
  ack: boolean
}

export interface Shipment {
  id: string
  ulipRef: string
  status: ShipmentStatus
  consignor: string
  consignee: string
  origin: string       // node code
  destination: string  // node code
  commodity: string
  hazardous: boolean
  reefer: boolean
  tempC?: number
  weightKg: number
  packages: number
  invoiceValue: number
  ewayBill: string
  gstin: string
  createdAt: string
  promisedEta: string
  eta: string
  deliveredAt: string | null
  delayMins: number
  progress: number     // 0..1 along the whole journey
  currentNode: string
  lat: number
  lon: number
  lastPingAt: string
  legs: Leg[]
  events: TrackEvent[]
  co2Kg: number
}

export interface FastagCrossing {
  id: string
  ts: string
  plaza: string
  plazaCode: string
  lane: string
  amount: number
  lat: number
  lon: number
  direction: 'N' | 'S' | 'E' | 'W'
}

export interface Vehicle {
  regNo: string
  vehicleClass: string
  makeModel: string
  owner: string
  fuel: 'Diesel' | 'CNG' | 'Electric' | 'LNG'
  capacityKg: number
  // VAHAN
  rcStatus: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'
  rcValidUpto: string
  fitnessUpto: string
  insuranceUpto: string
  pucUpto: string
  permitUpto: string
  permitType: string
  // FASTag
  tagId: string
  tagBank: string
  tagStatus: 'ACTIVE' | 'LOW_BALANCE' | 'BLACKLIST'
  tagBalance: number
  crossings: FastagCrossing[]
  // SARATHI
  driverName: string
  driverDl: string
  dlValidUpto: string
  driverPhone: string
  driverScore: number
  // Telemetry
  lat: number
  lon: number
  speedKmph: number
  headingDeg: number
  odometerKm: number
  fuelPct: number
  lastPingAt: string
  status: 'moving' | 'idle' | 'loading' | 'maintenance' | 'offline'
  shipmentId: string | null
  // Rolling analytics (30 day window)
  utilisationPct: number
  idleHrs: number
  detentionHrs: number
  distance30dKm: number
  tollSpend30d: number
}

export type DocType =
  | 'eway' | 'gst_invoice' | 'lorry_receipt' | 'bill_of_lading'
  | 'bill_of_entry' | 'shipping_bill' | 'permit' | 'insurance'
  | 'puc' | 'fitness' | 'air_waybill' | 'rail_receipt'

export type DocStatus = 'valid' | 'expiring' | 'expired' | 'mismatch' | 'pending'

export interface ComplianceDoc {
  id: string
  type: DocType
  number: string
  linkedTo: string
  linkedKind: 'shipment' | 'vehicle'
  issuedAt: string
  validUpto: string
  status: DocStatus
  source: SourceSystem
  issuer: string
  value?: number
  verifiedAt: string | null
  digest: string
  remark?: string
}

/** Per-tenant runtime state for a catalogue endpoint (subscription + usage). */
export interface EndpointStats {
  subscribed: boolean
  avgLatencyMs: number
  successPct: number
  quota: number
  used: number
}

export interface ApiCall {
  id: string
  ts: string
  /** Real ULIP endpoint code, e.g. 'FASTAG/01'. */
  endpointId: string
  status: number
  latencyMs: number
  bytes: number
  consumer: string
  /** Inner responseStatus — a 200 can still carry ERROR records. */
  resolved: boolean
}

export interface KpiPoint { date: string; [k: string]: number | string }

export interface Org {
  id: string
  name: string
  gstin: string
  role: 'Shipper' | 'Transporter' | 'Freight Forwarder' | 'Regulator'
  ulipClientId: string
  plan: 'Sandbox' | 'Production'
  members: number
}

export interface Session {
  name: string
  email: string
  role: string
  org: Org
}
