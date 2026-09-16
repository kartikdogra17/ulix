import type { Node } from '../types'

export interface LatLon { lat: number; lon: number }

/** Deterministic PRNG so every reload of the demo shows the same world. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
export const int = (r: () => number, lo: number, hi: number) => Math.floor(lo + r() * (hi - lo + 1))
export const float = (r: () => number, lo: number, hi: number, dp = 2) =>
  +(lo + r() * (hi - lo)).toFixed(dp)

/** Logistics nodes, positioned by real coordinates. */
export const NODES: Node[] = [
  { code: 'DEL', name: 'Delhi NCR',       state: 'Delhi',          lat: 28.61, lon: 77.21, kind: 'city' },
  { code: 'TKD', name: 'Tughlakabad ICD', state: 'Delhi',          lat: 28.51, lon: 77.30, kind: 'icd' },
  { code: 'DER', name: 'Dadri ICD',       state: 'Uttar Pradesh',  lat: 28.55, lon: 77.55, kind: 'icd' },
  { code: 'BOM', name: 'Mumbai',          state: 'Maharashtra',    lat: 19.08, lon: 72.88, kind: 'city' },
  { code: 'NSA', name: 'JNPA Nhava Sheva',state: 'Maharashtra',    lat: 18.95, lon: 72.94, kind: 'port' },
  { code: 'PNQ', name: 'Pune',            state: 'Maharashtra',    lat: 18.52, lon: 73.86, kind: 'city' },
  { code: 'NAG', name: 'Nagpur',          state: 'Maharashtra',    lat: 21.15, lon: 79.09, kind: 'railhead' },
  { code: 'MAA', name: 'Chennai',         state: 'Tamil Nadu',     lat: 13.08, lon: 80.27, kind: 'port' },
  { code: 'TUT', name: 'Tuticorin',       state: 'Tamil Nadu',     lat:  8.76, lon: 78.13, kind: 'port' },
  { code: 'CJB', name: 'Coimbatore',      state: 'Tamil Nadu',     lat: 11.02, lon: 76.96, kind: 'city' },
  { code: 'CCU', name: 'Kolkata',         state: 'West Bengal',    lat: 22.57, lon: 88.36, kind: 'city' },
  { code: 'HAL', name: 'Haldia',          state: 'West Bengal',    lat: 22.06, lon: 88.11, kind: 'port' },
  { code: 'BLR', name: 'Bengaluru',       state: 'Karnataka',      lat: 12.97, lon: 77.59, kind: 'city' },
  { code: 'HYD', name: 'Hyderabad',       state: 'Telangana',      lat: 17.38, lon: 78.49, kind: 'city' },
  { code: 'AMD', name: 'Ahmedabad',       state: 'Gujarat',        lat: 23.02, lon: 72.57, kind: 'city' },
  { code: 'STV', name: 'Surat',           state: 'Gujarat',        lat: 21.17, lon: 72.83, kind: 'city' },
  { code: 'MUN', name: 'Mundra',          state: 'Gujarat',        lat: 22.84, lon: 69.72, kind: 'port' },
  { code: 'IXY', name: 'Deendayal Kandla',state: 'Gujarat',        lat: 23.03, lon: 70.22, kind: 'port' },
  { code: 'JAI', name: 'Jaipur',          state: 'Rajasthan',      lat: 26.91, lon: 75.79, kind: 'city' },
  { code: 'LKO', name: 'Lucknow',         state: 'Uttar Pradesh',  lat: 26.85, lon: 80.95, kind: 'city' },
  { code: 'KNU', name: 'Kanpur',          state: 'Uttar Pradesh',  lat: 26.45, lon: 80.33, kind: 'railhead' },
  { code: 'LUH', name: 'Ludhiana',        state: 'Punjab',         lat: 30.90, lon: 75.85, kind: 'icd' },
  { code: 'IDR', name: 'Indore',          state: 'Madhya Pradesh', lat: 22.72, lon: 75.86, kind: 'city' },
  { code: 'RPR', name: 'Raipur',          state: 'Chhattisgarh',   lat: 21.25, lon: 81.63, kind: 'railhead' },
  { code: 'BBI', name: 'Bhubaneswar',     state: 'Odisha',         lat: 20.30, lon: 85.82, kind: 'city' },
  { code: 'PRD', name: 'Paradip',         state: 'Odisha',         lat: 20.27, lon: 86.61, kind: 'port' },
  { code: 'VTZ', name: 'Visakhapatnam',   state: 'Andhra Pradesh', lat: 17.69, lon: 83.22, kind: 'port' },
  { code: 'COK', name: 'Kochi',           state: 'Kerala',         lat:  9.93, lon: 76.27, kind: 'port' },
  { code: 'PAT', name: 'Patna',           state: 'Bihar',          lat: 25.59, lon: 85.14, kind: 'city' },
  { code: 'GAU', name: 'Guwahati',        state: 'Assam',          lat: 26.14, lon: 91.74, kind: 'city' },
]

export const NODE_BY_CODE = Object.fromEntries(NODES.map((n) => [n.code, n])) as Record<string, Node>
export const nodeName = (code: string) => NODE_BY_CODE[code]?.name ?? code

/** Great-circle distance, km. Takes anything with coordinates, not just a Node. */
export function haversine(a: LatLon, b: LatLon) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export const CARRIERS_ROAD = [
  'Bharat Freightways', 'Deccan Roadlines', 'Sahyadri Carriers', 'Ganga Logistics',
  'Konkan Transways', 'Aravalli Movers', 'Coromandel Haulage', 'Vindhya Cargo',
] as const

export const CARRIERS_RAIL = ['CONCOR', 'Indian Railways FOIS', 'DFCCIL Corridor', 'Adani Rail'] as const
export const CARRIERS_SEA = ['Shipping Corp of India', 'Maersk Line', 'Bharat Coastal', 'Ocean Link'] as const
export const CARRIERS_AIR = ['Air India Cargo', 'IndiGo CarGo', 'Blue Dart Aviation', 'SpiceXpress'] as const

export const COMMODITIES = [
  'Cotton yarn', 'Auto components', 'Pharmaceutical formulations', 'Basmati rice',
  'Polypropylene granules', 'Ceramic tiles', 'Steel coils', 'Solar modules',
  'Frozen marine products', 'Electronics — SKD kits', 'Fertiliser — urea', 'Cement',
  'Tea chests', 'Leather goods', 'Bulk edible oil', 'Machinery spares',
] as const

export const COMPANIES = [
  'Tirupati Textiles Ltd', 'Meridian Auto Systems', 'Sanjeevani Pharma', 'Annapurna Agro Exports',
  'Polychem Industries', 'Rajdhani Ceramics', 'Ispat Metals Pvt Ltd', 'Suryodaya Energy',
  'Sagar Marine Foods', 'Nexa Electronics', 'Krishi Fertilisers', 'Sahyadri Cement',
  'Assam Tea Estates', 'Kanpur Leathercraft', 'Godavari Oils', 'Precision Engineering Co',
] as const

export const DRIVER_NAMES = [
  'Ramesh Yadav', 'Satnam Singh', 'Mohammed Irfan', 'Balu Naik', 'Prakash Jadhav',
  'Dilip Barman', 'Hari Om Sharma', 'Sadiq Ali', 'Venkatesh Rao', 'Jaspreet Gill',
  'Manoj Kumar', 'Arun Pillai', 'Shyam Sundar', 'Gurmeet Sandhu', 'Ravi Teja',
  'Imran Qureshi', 'Deepak Mahto', 'Sukhdev Rana', 'Nitin Patil', 'Alok Mishra',
] as const

export const TOLL_PLAZAS = [
  ['Kherki Daula', 'NH48', 28.42, 76.99], ['Manoharpur', 'NH48', 27.29, 75.95],
  ['Shahjahanpur', 'NH48', 27.93, 76.35], ['Charoti', 'NH48', 19.97, 72.94],
  ['Khalapur', 'NH48', 18.82, 73.34], ['Talegaon', 'NH48', 18.73, 73.68],
  ['Kilambakkam', 'NH32', 12.83, 80.03], ['Paranur', 'NH32', 12.74, 79.99],
  ['Dankuni', 'NH19', 22.68, 88.29], ['Palsit', 'NH19', 23.17, 87.96],
  ['Attibele', 'NH44', 12.78, 77.77], ['Hebbal Flyover', 'NH44', 13.04, 77.59],
  ['Bhiwandi', 'NH3', 19.30, 73.06], ['Vadape', 'NH3', 19.30, 73.14],
  ['Sanand', 'NH147', 22.99, 72.38], ['Bagodara', 'NH47', 22.60, 72.30],
] as const

export const VEHICLE_SERIES = [
  'MH12', 'MH04', 'DL01', 'HR55', 'GJ01', 'GJ12', 'TN38', 'TN01',
  'KA01', 'KA51', 'WB23', 'UP78', 'PB10', 'RJ14', 'TS09', 'AP16',
] as const

export const MAKE_MODELS = [
  'Tata Prima 4028.S', 'Ashok Leyland 3520', 'BharatBenz 3532R', 'Eicher Pro 6055',
  'Tata Signa 5530.S', 'Mahindra Blazo X 55', 'Volvo FM 460', 'Scania R 500',
] as const

export const STATE_GST: Record<string, string> = {
  Delhi: '07', Maharashtra: '27', 'Tamil Nadu': '33', 'West Bengal': '19',
  Karnataka: '29', Telangana: '36', Gujarat: '24', Rajasthan: '08',
  'Uttar Pradesh': '09', Punjab: '03', 'Madhya Pradesh': '23', Chhattisgarh: '22',
  Odisha: '21', 'Andhra Pradesh': '37', Kerala: '32', Bihar: '10', Assam: '18',
}
