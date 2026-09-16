import type {
  ComplianceDoc, DocStatus, DocType, Exception, ExceptionType,
  FastagCrossing, Leg, Mode, Shipment, ShipmentStatus, TrackEvent, Vehicle,
} from '../types'
import {
  CARRIERS_AIR, CARRIERS_RAIL, CARRIERS_ROAD, CARRIERS_SEA, COMMODITIES, COMPANIES,
  DRIVER_NAMES, MAKE_MODELS, NODES, NODE_BY_CODE, STATE_GST, TOLL_PLAZAS, VEHICLE_SERIES,
  float, haversine, int, pick, rng,
} from './seed'

const HOUR = 3600_000
const DAY = 24 * HOUR
export const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

/* Example values quoted in the ULIP integration documents. Seeding them into
   the simulated world means the API console's prefilled requests resolve,
   the way they would against a real subscription. */
export const DOC_EXAMPLE_EWB = '101000609218'
/** Registrations quoted in FASTAG/01, FASTAG/02, VAHAN/01 and ECHALLAN/01. */
export const DOC_EXAMPLE_VRNS = ['GA060000', 'MP09HF4987', 'MH12AB1234', 'UP93BK9110']
export const DOC_EXAMPLE_TAGID = '34161FA8203286140F4064E0'

const PORTS = NODES.filter((n) => n.kind === 'port').map((n) => n.code)
const INLAND = NODES.filter((n) => n.kind !== 'port').map((n) => n.code)

function gstin(r: () => number, state: string) {
  const code = STATE_GST[state] ?? '27'
  const pan = Array.from({ length: 5 }, () => String.fromCharCode(65 + int(r, 0, 25))).join('')
  return `${code}${pan}${int(r, 1000, 9999)}${String.fromCharCode(65 + int(r, 0, 25))}1Z${int(r, 0, 9)}`
}

function regNo(r: () => number) {
  const series = pick(r, VEHICLE_SERIES)
  const letters = String.fromCharCode(65 + int(r, 0, 25)) + String.fromCharCode(65 + int(r, 0, 25))
  return `${series}${letters}${int(r, 1000, 9999)}`
}

/** Interpolate a point `t` of the way from a to b (straight-line approximation). */
function lerpNode(from: string, to: string, t: number) {
  const a = NODE_BY_CODE[from], b = NODE_BY_CODE[to]
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
}

const MODE_SPEED: Record<Mode, number> = { road: 38, rail: 46, sea: 26, air: 620 }

function buildLegs(r: () => number, origin: string, destination: string, startMs: number): Leg[] {
  const legs: Leg[] = []
  const originIsPort = PORTS.includes(origin)
  const destIsPort = PORTS.includes(destination)
  const plan: Array<[Mode, string, string]> = []

  if (originIsPort && !destIsPort) {
    // Import lane: sea already done → port to ICD by rail → last mile by road
    const hub = pick(r, ['TKD', 'DER', 'LUH', 'NAG', 'KNU', 'RPR'])
    plan.push(['rail', origin, hub], ['road', hub, destination])
  } else if (!originIsPort && destIsPort) {
    const hub = pick(r, ['TKD', 'DER', 'NAG', 'KNU'])
    plan.push(['road', origin, hub], ['rail', hub, destination])
  } else if (r() < 0.12) {
    plan.push(['air', origin, destination])
  } else if (r() < 0.25) {
    const hub = pick(r, ['NAG', 'KNU', 'IDR', 'RPR'])
    plan.push(['road', origin, hub], ['road', hub, destination])
  } else {
    plan.push(['road', origin, destination])
  }

  let cursor = startMs
  for (const [mode, from, to] of plan) {
    if (from === to) continue
    const km = haversine(NODE_BY_CODE[from], NODE_BY_CODE[to])
    const hrs = km / MODE_SPEED[mode] + (mode === 'air' ? 4 : mode === 'rail' ? 6 : 1)
    const dep = cursor + int(r, 0, 6) * HOUR
    const arr = dep + hrs * HOUR
    const carrier =
      mode === 'road' ? pick(r, CARRIERS_ROAD)
      : mode === 'rail' ? pick(r, CARRIERS_RAIL)
      : mode === 'sea' ? pick(r, CARRIERS_SEA)
      : pick(r, CARRIERS_AIR)
    const conveyance =
      mode === 'road' ? regNo(r)
      : mode === 'rail' ? `${int(r, 10000, 19999)}/${pick(r, ['BCN', 'BOXN', 'BLC'])}`
      : mode === 'sea' ? `IMO${int(r, 9000000, 9899999)}`
      : `${pick(r, ['AI', '6E', 'BD', 'SG'])}${int(r, 100, 999)}`

    legs.push({
      id: `LEG-${legs.length + 1}`,
      mode, carrier, conveyance, from, to,
      plannedDep: iso(dep), actualDep: null,
      plannedArr: iso(arr), actualArr: null,
      status: 'pending',
      distanceKm: km,
    })
    cursor = arr
  }
  return legs
}

const EVENT_LIB: Array<[string, string, TrackEvent['source']]> = [
  ['EWB_GEN', 'e-Way Bill generated', 'eWayBill'],
  ['GATE_OUT', 'Gate-out from consignor premises', 'ULIP'],
  ['TOLL_TXN', 'FASTag toll plaza crossing', 'FASTag'],
  ['RC_VERIFY', 'Vehicle RC & fitness verified', 'VAHAN'],
  ['DL_VERIFY', 'Driver licence validated', 'SARATHI'],
  ['RAIL_LOAD', 'Rake loading completed', 'FOIS'],
  ['RAIL_DEP', 'Rake departed from railhead', 'FOIS'],
  ['CUSTOMS_IN', 'Bill of Entry filed', 'ICEGATE'],
  ['CUSTOMS_OK', 'Customs out-of-charge granted', 'ICEGATE'],
  ['PORT_GATE', 'Container gate-in at terminal', 'PCS'],
  ['AWB_ACCEPT', 'Air waybill accepted at cargo terminal', 'AirCargo'],
  ['HUB_IN', 'Arrived at transshipment hub', 'ULIP'],
  ['HUB_OUT', 'Dispatched from transshipment hub', 'ULIP'],
  ['OFD', 'Out for delivery', 'ULIP'],
  ['POD', 'Proof of delivery captured', 'ULIP'],
]

function buildEvents(r: () => number, s: Omit<Shipment, 'events'>): TrackEvent[] {
  const out: TrackEvent[] = []
  const start = Date.parse(s.createdAt)
  const span = Date.parse(s.eta) - start
  const n = int(r, 6, 13)
  const used = new Set<number>()
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1)
    if (t > s.progress + 0.02) break
    let idx = i === 0 ? 0 : int(r, 1, EVENT_LIB.length - 2)
    while (used.has(idx) && used.size < EVENT_LIB.length) idx = int(r, 1, EVENT_LIB.length - 2)
    used.add(idx)
    const [code, label, source] = EVENT_LIB[idx]
    const p = lerpNode(s.origin, s.destination, t)
    const near = NODES.reduce((best, nd) =>
      Math.hypot(nd.lat - p.lat, nd.lon - p.lon) < Math.hypot(best.lat - p.lat, best.lon - p.lon) ? nd : best, NODES[0])
    out.push({
      id: `${s.id}-E${i}`,
      ts: iso(start + span * t),
      code, label, source,
      location: `${near.name}, ${near.state}`,
      lat: p.lat, lon: p.lon,
    })
  }
  if (s.status === 'delivered') {
    out.push({
      id: `${s.id}-EPOD`, ts: s.deliveredAt ?? s.eta, code: 'POD',
      label: 'Proof of delivery captured', source: 'ULIP',
      location: `${NODE_BY_CODE[s.destination].name}, ${NODE_BY_CODE[s.destination].state}`,
      lat: NODE_BY_CODE[s.destination].lat, lon: NODE_BY_CODE[s.destination].lon,
      note: 'Signed by consignee representative',
    })
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

const STATUS_WEIGHTS: Array<[ShipmentStatus, number]> = [
  ['delivered', 0.34], ['in_transit', 0.30], ['at_hub', 0.10],
  ['out_for_delivery', 0.08], ['customs', 0.06], ['planned', 0.07], ['exception', 0.05],
]

function weightedStatus(r: () => number): ShipmentStatus {
  let x = r()
  for (const [s, w] of STATUS_WEIGHTS) { if ((x -= w) <= 0) return s }
  return 'in_transit'
}

export function makeShipments(count = 160): Shipment[] {
  const r = rng(20260915)
  const out: Shipment[] = []
  for (let i = 0; i < count; i++) {
    const useSea = r() < 0.22
    const origin = useSea ? pick(r, PORTS) : pick(r, INLAND)
    let destination = useSea ? pick(r, INLAND) : pick(r, r() < 0.2 ? PORTS : INLAND)
    while (destination === origin) destination = pick(r, INLAND)

    const status = weightedStatus(r)
    const createdAt = NOW - int(r, 1, 26) * DAY - int(r, 0, 23) * HOUR
    const legs = buildLegs(r, origin, destination, createdAt)
    if (!legs.length) continue
    const plannedArr = Date.parse(legs[legs.length - 1].plannedArr)
    const delayMins = status === 'exception' ? int(r, 240, 1900)
      : r() < 0.26 ? int(r, 30, 600) : int(r, -120, 25)
    const eta = plannedArr + delayMins * 60_000

    const progress =
      status === 'delivered' ? 1
      : status === 'planned' ? 0
      : status === 'out_for_delivery' ? float(r, 0.9, 0.98, 3)
      : status === 'customs' ? float(r, 0.6, 0.75, 3)
      : status === 'at_hub' ? float(r, 0.4, 0.6, 3)
      : float(r, 0.12, 0.85, 3)

    // Mark leg progress
    const totalKm = legs.reduce((a, l) => a + l.distanceKm, 0)
    let walked = 0
    for (const leg of legs) {
      const legStart = walked / totalKm
      const legEnd = (walked + leg.distanceKm) / totalKm
      walked += leg.distanceKm
      if (progress >= legEnd) {
        leg.status = 'completed'
        leg.actualDep = leg.plannedDep
        leg.actualArr = iso(Date.parse(leg.plannedArr) + int(r, -40, 90) * 60_000)
      } else if (progress > legStart) {
        leg.status = delayMins > 180 ? 'delayed' : 'active'
        leg.actualDep = leg.plannedDep
      }
    }

    const p = lerpNode(origin, destination, progress)
    const currentNode = NODES.reduce((best, nd) =>
      Math.hypot(nd.lat - p.lat, nd.lon - p.lon) < Math.hypot(best.lat - p.lat, best.lon - p.lon) ? nd : best, NODES[0])
    const originNode = NODE_BY_CODE[origin]
    const weightKg = int(r, 900, 28000)
    const reefer = r() < 0.14

    const base: Omit<Shipment, 'events'> = {
      id: `CN${String(260000 + i)}`,
      ulipRef: `ULIP-${new Date(createdAt).getFullYear()}-${String(400000 + i * 7)}`,
      status,
      consignor: pick(r, COMPANIES),
      consignee: pick(r, COMPANIES),
      origin, destination,
      commodity: pick(r, COMMODITIES),
      hazardous: r() < 0.08,
      reefer,
      tempC: reefer ? float(r, -22, 6, 1) : undefined,
      weightKg,
      packages: int(r, 12, 1400),
      invoiceValue: int(r, 180000, 9800000),
      ewayBill: i === 0 ? DOC_EXAMPLE_EWB : String(int(r, 100000000000, 999999999999)),
      gstin: gstin(r, originNode.state),
      createdAt: iso(createdAt),
      promisedEta: iso(plannedArr),
      eta: iso(eta),
      deliveredAt: status === 'delivered' ? iso(eta - int(r, 0, 5) * HOUR) : null,
      delayMins,
      progress,
      currentNode: status === 'delivered' ? destination : currentNode.code,
      lat: status === 'delivered' ? NODE_BY_CODE[destination].lat : +p.lat.toFixed(4),
      lon: status === 'delivered' ? NODE_BY_CODE[destination].lon : +p.lon.toFixed(4),
      lastPingAt: iso(NOW - int(r, 1, 220) * 60_000),
      legs,
      co2Kg: Math.round(legs.reduce((a, l) =>
        a + l.distanceKm * (weightKg / 1000) * (l.mode === 'rail' ? 0.028 : l.mode === 'sea' ? 0.016 : l.mode === 'air' ? 0.6 : 0.09), 0)),
    }
    out.push({ ...base, events: buildEvents(r, base) })
  }
  return out
}

function crossings(r: () => number, n: number): FastagCrossing[] {
  return Array.from({ length: n }, (_, i) => {
    const [plaza, nh, lat, lon] = pick(r, TOLL_PLAZAS)
    return {
      id: `TX${int(r, 100000, 999999)}`,
      ts: iso(NOW - i * int(r, 3, 30) * HOUR - int(r, 0, 59) * 60_000),
      plaza: `${plaza} (${nh})`,
      plazaCode: `${nh}-${int(r, 100, 999)}`,
      lane: `L${int(r, 1, 8)}`,
      amount: int(r, 65, 940),
      lat, lon,
      direction: pick(r, ['N', 'S', 'E', 'W'] as const),
    }
  }).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
}

export function makeVehicles(shipments: Shipment[], spare = 30): Vehicle[] {
  const r = rng(77002026)

  /* Every consignment with a road leg under way has a real vehicle beneath it —
     otherwise FASTag, VAHAN and SARATHI would show "no data" for most of the
     network and the whole cross-system picture would look hollow. Vehicles are
     therefore generated FROM the legs, not sampled independently of them. */
  const activeLegs = shipments
    .filter((s) => s.status !== 'delivered' && s.status !== 'planned')
    .flatMap((s) => s.legs
      .filter((l) => l.mode === 'road' && l.status !== 'pending')
      .slice(0, 1)
      .map((l) => ({ s, l })))

  const out: Vehicle[] = []
  const total = activeLegs.length + spare

  for (let i = 0; i < total; i++) {
    const link = i < activeLegs.length ? activeLegs[i] : null
    // The first few carry the registrations the integration documents use in
    // their examples, so the API console's prefilled requests resolve.
    const reg = i < DOC_EXAMPLE_VRNS.length ? DOC_EXAMPLE_VRNS[i]
      : link ? link.l.conveyance : regNo(r)
    if (i < DOC_EXAMPLE_VRNS.length && link) link.l.conveyance = reg

    const p = link ? lerpNode(link.l.from, link.l.to, link.s.progress) : null
    const nd = p ?? NODE_BY_CODE[pick(r, INLAND)]

    const fitnessUpto = NOW + int(r, -20, 430) * DAY
    const insuranceUpto = NOW + int(r, -10, 360) * DAY
    const pucUpto = NOW + int(r, -15, 180) * DAY
    const dlValidUpto = NOW + int(r, -30, 2400) * DAY
    const tagBalance = r() < 0.12 ? int(r, 20, 180) : int(r, 400, 9500)

    out.push({
      regNo: reg,
      vehicleClass: pick(r, ['HGV — 4 Axle', 'MGV — 3 Axle', 'HGV — 6 Axle', 'LGV — 2 Axle', 'Trailer — 40ft']),
      makeModel: pick(r, MAKE_MODELS),
      owner: link ? link.l.carrier : pick(r, CARRIERS_ROAD),
      fuel: pick(r, ['Diesel', 'Diesel', 'Diesel', 'CNG', 'LNG', 'Electric'] as const),
      // A realistic mix: the national fleet is still far from fully BS-VI.
      bsNorm: pick(r, ['BS-VI', 'BS-VI', 'BS-IV', 'BS-IV', 'BS-III'] as const),
      capacityKg: int(r, 9000, 42000),
      rcStatus: r() < 0.05 ? 'SUSPENDED' : 'ACTIVE',
      rcValidUpto: iso(NOW + int(r, 200, 3000) * DAY),
      fitnessUpto: iso(fitnessUpto),
      insuranceUpto: iso(insuranceUpto),
      pucUpto: iso(pucUpto),
      permitUpto: iso(NOW + int(r, -5, 500) * DAY),
      permitType: pick(r, ['National Permit', 'State Permit — MH', 'National Permit', 'Contract Carriage']),
      tagId: i === 0 ? DOC_EXAMPLE_TAGID : `34161FA8${int(r, 10000000, 99999999)}`,
      tagBank: pick(r, ['ICICI Bank', 'HDFC Bank', 'Paytm Payments Bank', 'IDFC First', 'SBI', 'Axis Bank']),
      tagStatus: tagBalance < 200 ? 'LOW_BALANCE' : r() < 0.03 ? 'BLACKLIST' : 'ACTIVE',
      tagBalance,
      crossings: crossings(r, int(r, 5, 14)),
      driverName: pick(r, DRIVER_NAMES),
      driverDl: `${pick(r, VEHICLE_SERIES).slice(0, 2)}${int(r, 10, 99)} ${int(r, 19900000000, 20239999999)}`,
      dlValidUpto: iso(dlValidUpto),
      driverPhone: `+91 ${int(r, 70, 99)}••• ••${int(r, 10, 99)}`,
      driverScore: int(r, 58, 99),
      lat: +nd.lat.toFixed(4),
      lon: +nd.lon.toFixed(4),
      speedKmph: link ? int(r, 0, 78) : 0,
      headingDeg: int(r, 0, 359),
      odometerKm: int(r, 48000, 890000),
      fuelPct: int(r, 8, 98),
      lastPingAt: iso(NOW - int(r, 1, 180) * 60_000),
      status: !link ? pick(r, ['idle', 'loading', 'maintenance', 'offline'] as const)
        : r() < 0.15 ? 'idle' : 'moving',
      shipmentId: link ? link.s.id : null,
      utilisationPct: int(r, 41, 96),
      idleHrs: float(r, 4, 68, 1),
      detentionHrs: float(r, 0.5, 26, 1),
      distance30dKm: int(r, 2200, 16800),
      tollSpend30d: int(r, 4000, 46000),
    })
  }
  return out
}

const DOC_META: Record<DocType, { label: string; source: ComplianceDoc['source']; issuer: string }> = {
  eway:           { label: 'e-Way Bill',        source: 'eWayBill', issuer: 'NIC / GSTN' },
  gst_invoice:    { label: 'GST Tax Invoice',   source: 'GSTN',     issuer: 'GST Network' },
  lorry_receipt:  { label: 'Lorry Receipt',     source: 'ULIP',     issuer: 'Transporter' },
  bill_of_lading: { label: 'Bill of Lading',    source: 'PCS',      issuer: 'Shipping Line' },
  bill_of_entry:  { label: 'Bill of Entry',     source: 'ICEGATE',  issuer: 'CBIC' },
  shipping_bill:  { label: 'Shipping Bill',     source: 'ICEGATE',  issuer: 'CBIC' },
  permit:         { label: 'National Permit',   source: 'VAHAN',    issuer: 'State RTO' },
  insurance:      { label: 'Motor Insurance',   source: 'VAHAN',    issuer: 'IRDAI Insurer' },
  puc:            { label: 'PUC Certificate',   source: 'VAHAN',    issuer: 'Authorised Centre' },
  fitness:        { label: 'Fitness Certificate', source: 'VAHAN',  issuer: 'State RTO' },
  air_waybill:    { label: 'Air Waybill',       source: 'AirCargo', issuer: 'Airline' },
  rail_receipt:   { label: 'Railway Receipt',   source: 'FOIS',     issuer: 'Indian Railways' },
}

export const docLabel = (t: DocType) => DOC_META[t].label

export function makeDocs(shipments: Shipment[], vehicles: Vehicle[]): ComplianceDoc[] {
  const r = rng(31122025)
  const out: ComplianceDoc[] = []

  const statusFor = (
    validUpto: number, mismatch: boolean, pending: boolean, closed = false,
  ): DocStatus => {
    if (pending) return 'pending'
    if (mismatch) return 'mismatch'
    // A document whose journey has completed is archived, not delinquent —
    // an e-Way Bill lapsing after delivery is the normal end of its life.
    if (closed) return 'valid'
    if (validUpto < NOW) return 'expired'
    if (validUpto - NOW < 21 * DAY) return 'expiring'
    return 'valid'
  }

  for (const s of shipments) {
    const types: DocType[] = ['eway', 'gst_invoice', 'lorry_receipt']
    if (s.legs.some((l) => l.mode === 'rail')) types.push('rail_receipt')
    if (s.legs.some((l) => l.mode === 'air')) types.push('air_waybill')
    if (s.status === 'customs' || NODE_BY_CODE[s.origin].kind === 'port') types.push('bill_of_entry')
    if (NODE_BY_CODE[s.destination].kind === 'port') types.push('shipping_bill', 'bill_of_lading')

    for (const t of types) {
      const issuedAt = Date.parse(s.createdAt) - int(r, 0, 2) * DAY
      const validUpto = issuedAt + int(r, 3, 30) * DAY
      const mismatch = r() < 0.035
      const pending = r() < 0.04 && s.status !== 'delivered'
      const st = statusFor(validUpto, mismatch, pending, s.status === 'delivered')
      out.push({
        id: `DOC-${out.length + 1000}`,
        type: t,
        number: t === 'eway' ? s.ewayBill
          : t === 'bill_of_entry' ? `BE${int(r, 1000000, 9999999)}`
          : t === 'shipping_bill' ? `SB${int(r, 1000000, 9999999)}`
          : `${t.slice(0, 3).toUpperCase()}${int(r, 100000, 999999)}`,
        linkedTo: s.id,
        linkedKind: 'shipment',
        issuedAt: iso(issuedAt),
        validUpto: iso(validUpto),
        status: st,
        source: DOC_META[t].source,
        issuer: DOC_META[t].issuer,
        value: t === 'gst_invoice' || t === 'eway' ? s.invoiceValue : undefined,
        verifiedAt: st === 'pending' ? null : iso(issuedAt + int(r, 1, 40) * HOUR),
        digest: `sha256:${Array.from({ length: 10 }, () => '0123456789abcdef'[int(r, 0, 15)]).join('')}…`,
        remark: mismatch ? pick(r, [
          'Consignee GSTIN differs from tax invoice',
          'Declared weight exceeds e-Way Bill by 8.4%',
          'HSN code mismatch against invoice line 3',
          'Vehicle number on Part-B not updated',
        ]) : undefined,
      })
    }
  }

  for (const v of vehicles) {
    const vTypes: Array<[DocType, string]> = [
      ['fitness', v.fitnessUpto], ['insurance', v.insuranceUpto],
      ['puc', v.pucUpto], ['permit', v.permitUpto],
    ]
    for (const [t, valid] of vTypes) {
      const validUpto = Date.parse(valid)
      out.push({
        id: `DOC-${out.length + 1000}`,
        type: t,
        number: `${t.slice(0, 2).toUpperCase()}${int(r, 10000000, 99999999)}`,
        linkedTo: v.regNo,
        linkedKind: 'vehicle',
        issuedAt: iso(validUpto - 365 * DAY),
        validUpto: valid,
        status: statusFor(validUpto, false, false),
        source: 'VAHAN',
        issuer: DOC_META[t].issuer,
        verifiedAt: iso(NOW - int(r, 1, 20) * DAY),
        digest: `sha256:${Array.from({ length: 10 }, () => '0123456789abcdef'[int(r, 0, 15)]).join('')}…`,
      })
    }
  }
  return out
}

export function makeExceptions(shipments: Shipment[], vehicles: Vehicle[], docs: ComplianceDoc[]): Exception[] {
  const r = rng(9091)
  const out: Exception[] = []
  const push = (type: ExceptionType, sev: Exception['severity'], entity: string,
                kind: Exception['entityKind'], note: string, ageH: number) =>
    out.push({
      id: `EX-${out.length + 500}`, type, severity: sev, entity, entityKind: kind,
      raisedAt: iso(NOW - ageH * HOUR), note, ack: r() < 0.35,
    })

  for (const s of shipments) {
    if (s.delayMins > 240 && s.status !== 'delivered')
      push('delay', s.delayMins > 900 ? 'high' : 'medium', s.id, 'shipment',
        `Running ${Math.round(s.delayMins / 60)}h behind promised ETA on the ${s.legs[s.legs.length - 1].mode} leg`, int(r, 1, 40))
    if (s.reefer && s.tempC !== undefined && s.tempC > 2 && s.status === 'in_transit')
      push('temperature', 'high', s.id, 'shipment',
        `Reefer set point breached — logging ${s.tempC}°C against a −18°C mandate`, int(r, 1, 12))
    if (s.status === 'customs' && r() < 0.35)
      push('customs_hold', 'medium', s.id, 'shipment',
        'Bill of Entry under assessment query at ICEGATE — awaiting importer response', int(r, 2, 60))
  }
  for (const v of vehicles) {
    if (v.tagStatus === 'BLACKLIST')
      push('tag_blacklist', 'high', v.regNo, 'vehicle', 'FASTag blacklisted by issuing bank — plaza entry will be denied', int(r, 1, 30))
    if (Date.parse(v.fitnessUpto) < NOW)
      push('fitness_expiry', 'high', v.regNo, 'vehicle', 'Fitness certificate lapsed — vehicle is not road legal', int(r, 1, 90))
    if (v.detentionHrs > 20)
      push('detention', 'medium', v.regNo, 'vehicle', `${v.detentionHrs}h detention accrued this cycle at consignee docks`, int(r, 1, 48))
  }
  for (const d of docs) {
    if (d.status === 'mismatch')
      push('doc_mismatch', 'medium', d.linkedTo, 'document', d.remark ?? 'Document mismatch detected', int(r, 1, 50))
  }
  return out.sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt)).slice(0, 60)
}

/* ── KPI time series ─────────────────────────────────────────── */

export function makeDailySeries(days = 30) {
  const r = rng(4242)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(NOW - (days - 1 - i) * DAY)
    const weekend = d.getDay() === 0
    const base = weekend ? int(r, 40, 70) : int(r, 95, 165)
    const delivered = Math.round(base * float(r, 0.72, 0.93))
    return {
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      created: base,
      delivered,
      delayed: Math.max(0, base - delivered - int(r, 0, 8)),
      onTimePct: +(delivered / base * 100).toFixed(1),
      apiCalls: int(r, 18000, 62000),
      latencyMs: int(r, 120, 420),
    }
  })
}

export function makeModalSplit() {
  const r = rng(808)
  return ([
    ['Road', 'road'], ['Rail', 'rail'], ['Sea', 'sea'], ['Air', 'air'],
  ] as const).map(([label, key], i) => ({
    label, key,
    tonneKm: [int(r, 480, 620), int(r, 210, 300), int(r, 120, 200), int(r, 18, 40)][i] * 1000,
    shareCost: [int(r, 52, 60), int(r, 18, 24), int(r, 10, 16), int(r, 6, 10)][i],
    co2Intensity: [62, 19, 11, 540][i],
  }))
}
