import type { ApiCall, EndpointStats } from '../types'
import { ULIP_ENDPOINTS, type UlipEndpoint } from '../ulip/catalogue'
import { int, pick, rng } from './seed'
import { NOW } from './generate'

export type CatalogueEntry = UlipEndpoint & EndpointStats

/**
 * Subscription and usage state over the real catalogue. A ULIP client is
 * approved per dataset, so most endpoints start unsubscribed — the console
 * mirrors the real onboarding reality rather than pretending to full access.
 */
const SUBSCRIBED = new Set([
  'FASTAG/01', 'FASTAG/02', 'VAHAN/01', 'VAHAN/02', 'SARATHI/01',
  'EWAYBILL/01', 'FOIS/01', 'FOIS/02', 'ICEGATE/02', 'ICEGATE/05',
  'PCS/01', 'PCS/04', 'LDB/01', 'TOLL/01', 'ECHALLAN/01', 'CARBON/01',
  'GATISHAKTI/01', 'GATISHAKTI/02', 'GATISHAKTI/03', 'GATISHAKTI/04', 'GATISHAKTI/05',
])

export function makeCatalogue(): CatalogueEntry[] {
  const r = rng(1979)
  return ULIP_ENDPOINTS.map((ep) => {
    const subscribed = SUBSCRIBED.has(ep.id)
    const quota = subscribed ? pick(r, [5000, 10000, 25000, 50000, 100000]) : 0
    return {
      ...ep,
      subscribed,
      avgLatencyMs: int(r, 180, 1250),
      successPct: +(95 + r() * 4.9).toFixed(1),
      quota,
      used: subscribed ? int(r, Math.round(quota * 0.05), Math.round(quota * 0.82)) : 0,
    }
  })
}

export function makeApiCalls(catalogue: CatalogueEntry[], count = 320): ApiCall[] {
  const r = rng(5150)
  const consumers = ['ops-console', 'tms-sync', 'billing-worker', 'mobile-app', 'partner-portal']
  const live = catalogue.filter((e) => e.subscribed)
  return Array.from({ length: count }, (_, i) => {
    const ep = pick(r, live)
    const roll = r()
    // Documented status codes; 200 dominates, and some 200s still fail inside.
    const status = roll < 0.93 ? 200 : roll < 0.955 ? 400 : roll < 0.975 ? 401
      : roll < 0.99 ? 403 : roll < 0.996 ? 500 : 502
    return {
      id: `RQ-${100000 + i}`,
      ts: new Date(NOW - i * int(r, 20, 240) * 1000).toISOString(),
      endpointId: ep.id,
      status,
      latencyMs: status === 200 ? int(r, ep.avgLatencyMs * 0.5, ep.avgLatencyMs * 2.1) : int(r, 60, 380),
      bytes: status === 200 ? int(r, 420, 24000) : int(r, 90, 300),
      consumer: pick(r, consumers),
      resolved: status === 200 ? r() > 0.09 : false,
    }
  })
}
