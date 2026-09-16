/* ────────────────────────────────────────────────────────────────
   Counterparty file — who you are actually dealing with.

   Every other screen assumes the consignor, consignee and carrier are
   simply names on a consignment. Four APIs say otherwise:

     MCA/03, MCA/04   company status, incorporation, registered office
     MCA/05           directors behind a DIN, and their standing
     UDYAM/01         MSME registration and enterprise class
     DGFT/01          IEC and its status, for anyone doing EXIM

   Two of the checks here earn their keep on their own.

   A company struck off the register is not a company you can enforce a
   contract against, and it will not show up anywhere in a consignment
   feed.

   And an MSME-registered counterparty puts you on a statutory clock:
   under s.15 of the MSMED Act 2006 a buyer must pay a registered micro
   or small enterprise within 45 days, with compound interest at three
   times the RBI bank rate after that. That is a payables obligation
   most TMS software never surfaces, because it lives in a different
   government system from the freight.
   ──────────────────────────────────────────────────────────────── */

import type { Shipment } from './types'
import { CARRIERS_ROAD, COMPANIES, NODES, STATE_GST, int, pick, rng } from './mock/seed'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'unchecked'

export interface Check {
  id: string
  label: string
  /** The endpoint that answers this check. */
  endpoint: string
  status: CheckStatus
  detail: string
}

export interface Director {
  din: string
  name: string
  dinStatus: 'Approved' | 'Disqualified' | 'Deactivated'
  appointedOn: string
}

export type CompanyStatus =
  | 'Active' | 'Strike Off' | 'Under Liquidation' | 'Dormant' | 'Amalgamated'

export type EnterpriseClass = 'Micro' | 'Small' | 'Medium'

export interface Counterparty {
  id: string
  name: string
  roles: Array<'consignor' | 'consignee' | 'transporter'>
  shipments: number
  valueHandled: number

  /* MCA/03 + MCA/04 */
  cin: string
  companyStatus: CompanyStatus
  incorporationDate: string
  rocName: string
  registeredState: string
  turnoverBand: string
  directors: Director[]

  /* UDYAM/01 — absent when the party is not MSME-registered */
  udyamNo: string | null
  enterpriseClass: EnterpriseClass | null
  udyamRegisteredAt: string | null

  /* DGFT/01 — absent when the party does no EXIM */
  iecNumber: string | null
  iecStatus: 'Valid' | 'Suspended' | 'Cancelled' | null

  gstin: string
  checks: Check[]
  risk: 'clear' | 'watch' | 'blocked'
  /** 0 clean … 100 do not trade. */
  score: number
  /** Names of other counterparties sharing a director. */
  relatedParties: string[]
}

/* ── Identifier shapes ────────────────────────────────────────── */

const STATE_MCA: Record<string, string> = {
  Maharashtra: 'MH', Delhi: 'DL', 'Tamil Nadu': 'TN', 'West Bengal': 'WB',
  Karnataka: 'KA', Telangana: 'TG', Gujarat: 'GJ', Rajasthan: 'RJ',
  'Uttar Pradesh': 'UP', Punjab: 'PB', 'Madhya Pradesh': 'MP',
  Chhattisgarh: 'CT', Odisha: 'OR', 'Andhra Pradesh': 'AP', Kerala: 'KL',
  Bihar: 'BR', Assam: 'AS',
}

const ROC: Record<string, string> = {
  Maharashtra: 'RoC-Mumbai', Delhi: 'RoC-Delhi', 'Tamil Nadu': 'RoC-Chennai',
  'West Bengal': 'RoC-Kolkata', Karnataka: 'RoC-Bangalore', Gujarat: 'RoC-Ahmedabad',
  Telangana: 'RoC-Hyderabad', 'Uttar Pradesh': 'RoC-Kanpur',
}

const DIRECTOR_FIRST = [
  'Arvind', 'Sunita', 'Rakesh', 'Priya', 'Vikas', 'Meera', 'Sanjay', 'Kavita',
  'Anil', 'Farida', 'Suresh', 'Nandini', 'Tarun', 'Lalita', 'Devendra', 'Shalini',
  'Gopal', 'Rekha', 'Naveen', 'Asha', 'Pranav', 'Ritu', 'Mahesh', 'Jyoti',
] as const
const DIRECTOR_LAST = [
  'Malhotra', 'Rao', 'Agarwal', 'Nair', 'Chandra', 'Krishnan', 'Bhatt', 'Desai',
  'Reddy', 'Contractor', 'Menon', 'Joshi', 'Kapoor', 'Iyer', 'Singh', 'Pillai',
] as const

function makeCin(r: () => number, state: string, year: number, listed: boolean) {
  const code = STATE_MCA[state] ?? 'MH'
  return `${listed ? 'L' : 'U'}${int(r, 10000, 99999)}${code}${year}PLC${int(r, 100000, 999999)}`
}

function gstinFor(r: () => number, state: string, pan: string) {
  return `${STATE_GST[state] ?? '27'}${pan}1Z${int(r, 0, 9)}`
}

function makePan(r: () => number) {
  const L = () => String.fromCharCode(65 + int(r, 0, 25))
  return `${L()}${L()}${L()}C${L()}${int(r, 1000, 9999)}${L()}`
}

/* ── Build the roster from parties actually in the network ────── */

export function makeCounterparties(shipments: Shipment[]): Counterparty[] {
  const r = rng(7781201)

  const roleMap = new Map<string, Set<'consignor' | 'consignee' | 'transporter'>>()
  const stats = new Map<string, { shipments: number; value: number }>()
  const note = (name: string, role: 'consignor' | 'consignee' | 'transporter', value: number) => {
    if (!roleMap.has(name)) roleMap.set(name, new Set())
    roleMap.get(name)!.add(role)
    const a = stats.get(name) ?? { shipments: 0, value: 0 }
    a.shipments++
    a.value += value
    stats.set(name, a)
  }

  const eximParties = new Set<string>()
  for (const s of shipments) {
    note(s.consignor, 'consignor', s.invoiceValue)
    note(s.consignee, 'consignee', s.invoiceValue)
    for (const l of s.legs) note(l.carrier, 'transporter', s.invoiceValue)
    if (s.legs.some((l) => l.mode === 'sea' || l.mode === 'air')) {
      eximParties.add(s.consignor)
      eximParties.add(s.consignee)
    }
  }
  for (const name of [...COMPANIES, ...CARRIERS_ROAD]) if (!roleMap.has(name)) note(name, 'consignor', 0)

  /* The pool must be large enough that sharing a director is the exception.
     A related-party check that fires on every counterparty tells you nothing,
     which is exactly what a 15-name pool produced. */
  const poolSize = Math.max(60, roleMap.size * 2)
  const pool: Director[] = Array.from({ length: poolSize }, (_, i) => ({
    din: String(10000000 + i * 137 + int(r, 10, 99)),
    name: `${DIRECTOR_FIRST[i % DIRECTOR_FIRST.length]} ${DIRECTOR_LAST[(i * 7) % DIRECTOR_LAST.length]}`,
    // A couple of genuinely disqualified directors, not a third of the register.
    dinStatus: i === 11 ? 'Disqualified' : i === 29 ? 'Deactivated' : 'Approved',
    appointedOn: new Date(Date.UTC(2010 + (i % 12), i % 12, 1 + (i % 27))).toISOString(),
  }))

  const parties: Counterparty[] = [...roleMap.keys()].sort().map((name, idx) => {
    const state = pick(r, NODES).state
    const year = int(r, 1985, 2021)
    const isTransporter = (CARRIERS_ROAD as readonly string[]).includes(name)
    const pan = makePan(r)

    // A small minority are not in good standing — that is the point of looking.
    const statusRoll = r()
    const companyStatus: CompanyStatus =
      statusRoll < 0.045 ? 'Strike Off'
      : statusRoll < 0.07 ? 'Under Liquidation'
      : statusRoll < 0.09 ? 'Dormant' : 'Active'

    const msme = r() < 0.42
    const enterpriseClass: EnterpriseClass | null = msme
      ? pick(r, ['Micro', 'Small', 'Small', 'Medium'] as const) : null

    // Anyone actually moving sea or air freight holds an IEC — customs will not
    // clear without one. So presence follows real activity, and the interesting
    // case is the rare lapse rather than a manufactured absence.
    const doesExim = !isTransporter && (eximParties.has(name) || r() < 0.15)
    const hasIec = doesExim && r() < 0.94
    const iecStatus = hasIec
      ? pick(r, ['Valid', 'Valid', 'Valid', 'Valid', 'Valid', 'Suspended'] as const) : null

    // Two directors each, drawn from disjoint slices — except for a seeded
    // minority who deliberately overlap, so the check has something real to find.
    const overlaps = idx % 9 === 3
    const directors = [
      pool[(idx * 2) % pool.length],
      overlaps ? pool[((idx - 1) * 2) % pool.length] : pool[(idx * 2 + 1) % pool.length],
    ].filter((d, i, a) => a.findIndex((x) => x.din === d.din) === i)

    const s = stats.get(name)!
    return {
      id: `CP-${String(idx + 1).padStart(3, '0')}`,
      name,
      roles: [...roleMap.get(name)!],
      shipments: s.shipments,
      valueHandled: s.value,
      cin: makeCin(r, state, year, r() < 0.15),
      companyStatus,
      incorporationDate: new Date(Date.UTC(year, int(r, 0, 11), int(r, 1, 28))).toISOString(),
      rocName: ROC[state] ?? 'RoC-Mumbai',
      registeredState: state,
      turnoverBand: pick(r, ['< ₹5 Cr', '₹5–25 Cr', '₹25–100 Cr', '₹100–500 Cr', '> ₹500 Cr']),
      directors,
      udyamNo: msme
        ? `UDYAM-${STATE_MCA[state] ?? 'MH'}-${String(int(r, 1, 30)).padStart(2, '0')}-${String(int(r, 1, 9999999)).padStart(7, '0')}`
        : null,
      enterpriseClass,
      udyamRegisteredAt: msme
        ? new Date(Date.UTC(int(r, 2016, 2025), int(r, 0, 11), int(r, 1, 28))).toISOString() : null,
      iecNumber: hasIec ? String(int(r, 1000000000, 9999999999)) : null,
      iecStatus,
      gstin: gstinFor(r, state, pan),
      checks: [],
      risk: 'clear',
      score: 0,
      relatedParties: [],
    }
  })

  /* Related parties: a shared director across two counterparties you trade
     with is the sort of thing nobody notices until it matters. */
  const byDin = new Map<string, string[]>()
  for (const p of parties) {
    for (const d of p.directors) {
      byDin.set(d.din, [...(byDin.get(d.din) ?? []), p.name])
    }
  }
  for (const p of parties) {
    const related = new Set<string>()
    for (const d of p.directors) {
      for (const other of byDin.get(d.din) ?? []) if (other !== p.name) related.add(other)
    }
    p.relatedParties = [...related]
  }

  for (const p of parties) Object.assign(p, evaluate(p, shipments))
  return parties.sort((a, b) => b.valueHandled - a.valueHandled)
}

/* ── The checks ───────────────────────────────────────────────── */

const WEIGHT: Record<CheckStatus, number> = { fail: 45, warn: 15, pass: 0, info: 0, unchecked: 5 }

function evaluate(p: Counterparty, shipments: Shipment[]) {
  const checks: Check[] = []

  /* 1. Is it a company you can actually contract with? */
  checks.push({
    id: 'mca-status',
    label: 'Company standing',
    endpoint: 'MCA/03',
    status: p.companyStatus === 'Active' ? 'pass'
      : p.companyStatus === 'Dormant' ? 'warn' : 'fail',
    detail: p.companyStatus === 'Active'
      ? `Active on the register, ${p.rocName}, incorporated ${new Date(p.incorporationDate).getFullYear()}.`
      : p.companyStatus === 'Strike Off'
      ? 'Struck off the register. There is no legal entity here to enforce a contract against — do not book new business.'
      : p.companyStatus === 'Under Liquidation'
      ? 'Under liquidation. Credit exposure ranks behind secured creditors; move to advance payment.'
      : 'Dormant on the register — filing obligations reduced, trading activity unlikely.',
  })

  /* 2. Directors in good standing */
  const badDirectors = p.directors.filter((d) => d.dinStatus !== 'Approved')
  checks.push({
    id: 'mca-directors',
    label: 'Directors',
    endpoint: 'MCA/05',
    status: badDirectors.length ? 'warn' : 'pass',
    detail: badDirectors.length
      ? `${badDirectors.map((d) => `${d.name} (${d.dinStatus})`).join(', ')} — a disqualified director cannot act for the company.`
      : `${p.directors.length} director${p.directors.length === 1 ? '' : 's'}, all approved.`,
  })

  /* 3. Related parties through a shared director */
  checks.push({
    id: 'related',
    label: 'Related parties',
    endpoint: 'MCA/05',
    status: p.relatedParties.length ? 'warn' : 'pass',
    detail: p.relatedParties.length
      ? `Shares a director with ${p.relatedParties.slice(0, 3).join(', ')}${p.relatedParties.length > 3 ? ` and ${p.relatedParties.length - 3} more` : ''}. Concentration and related-party exposure may be larger than it looks per counterparty.`
      : 'No shared directorships with other counterparties in this network.',
  })

  /* 4. MSME status — an obligation on you, not a risk from them. */
  const clockApplies = p.enterpriseClass === 'Micro' || p.enterpriseClass === 'Small'
  checks.push({
    id: 'udyam',
    label: 'MSME registration',
    endpoint: 'UDYAM/01',
    status: clockApplies ? 'info' : 'pass',
    detail: p.udyamNo
      ? clockApplies
        ? `Registered ${p.enterpriseClass} enterprise (${p.udyamNo}). Under s.15 of the MSMED Act you must settle invoices within 45 days; beyond that, compound interest at three times the RBI bank rate applies and the deduction may be disallowed under s.43B(h) of the Income Tax Act.`
        : `Registered Medium enterprise (${p.udyamNo}). The 45-day rule under s.15 covers micro and small only.`
      : 'Not registered on Udyam. Standard commercial payment terms apply.',
  })

  /* 5. IEC, but only where the party actually does EXIM */
  const eximShipments = shipments.filter(
    (s) => (s.consignor === p.name || s.consignee === p.name)
      && s.legs.some((l) => l.mode === 'sea' || l.mode === 'air'),
  ).length
  if (eximShipments || p.iecNumber) {
    checks.push({
      id: 'dgft-iec',
      label: 'Import-export code',
      endpoint: 'DGFT/01',
      status: !p.iecNumber ? (eximShipments ? 'fail' : 'unchecked')
        : p.iecStatus === 'Valid' ? 'pass' : 'fail',
      detail: !p.iecNumber
        ? `Handling ${eximShipments} sea or air consignment${eximShipments === 1 ? '' : 's'} with no IEC on file. Customs will not clear against a missing code.`
        : p.iecStatus === 'Valid'
        ? `IEC ${p.iecNumber} valid.`
        : `IEC ${p.iecNumber} is ${p.iecStatus?.toLowerCase()} — EXIM consignments for this party will not clear.`,
    })
  }

  /* 6. GSTIN state against the registered office */
  const gstState = p.gstin.slice(0, 2)
  const expected = STATE_GST[p.registeredState]
  checks.push({
    id: 'gstin-state',
    label: 'GSTIN consistency',
    endpoint: 'MCA/03 × e-Way Bill',
    status: expected && gstState === expected ? 'pass' : 'warn',
    detail: expected && gstState === expected
      ? `GSTIN state code ${gstState} matches the registered office in ${p.registeredState}.`
      : `GSTIN state code ${gstState} does not match the registered office in ${p.registeredState}. Either a legitimate additional place of business, or the wrong entity on the invoice.`,
  })

  const score = Math.min(100, checks.reduce((a, c) => a + WEIGHT[c.status], 0))
  const risk: Counterparty['risk'] =
    checks.some((c) => c.status === 'fail') ? 'blocked' : score >= 15 ? 'watch' : 'clear'

  return { checks, score, risk }
}

export const riskTone = (r: Counterparty['risk']) =>
  r === 'blocked' ? 'bad' : r === 'watch' ? 'warn' : 'ok'
