/* Delivery selection. The guard that matters most is never-twice: signals
   are recomputed on every read, so without it a poll would re-send the same
   conflict forever. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { selectForDelivery, buildPayload, DEFAULT_RULE, wasNotified } from '../src/data/notify'
import type { Case } from '../src/data/cases'

const H = 3600e3
const mk = (id: string, sev: 'critical' | 'high' | 'medium', o: Record<string, unknown> = {}): Case => ({
  signalId: id,
  status: (o.status as Case['status']) ?? 'open',
  assignee: (o.assignee as string | null) ?? null,
  snoozedUntil: null, resolution: null, updatedAt: new Date().toISOString(),
  activity: (o.activity as Case['activity']) ?? [{
    id: 'a', ts: new Date(Date.now() - ((o.ageH as number) ?? 1) * H).toISOString(),
    actor: 'sys', kind: 'created', detail: '',
  }],
  isDue: true,
  signal: {
    id, kind: 'fitness_lapsed', severity: sev, title: `T-${id}`, detail: '',
    sources: ['VAHAN/01'], entity: `CN${id}`, entityKind: 'shipment',
    valueAtRisk: (o.value as number) ?? 1e5, hoursToAct: null,
    detectedAt: new Date(Date.now() - ((o.ageH as number) ?? 1) * H).toISOString(),
    action: 'Do the thing.',
  },
} as Case)

describe('selectForDelivery', () => {
  test('criticals go', () => {
    assert.equal(selectForDelivery([mk('1', 'critical')], DEFAULT_RULE).length, 1)
  })
  test('routine severities do not', () => {
    assert.equal(selectForDelivery([mk('2', 'medium'), mk('3', 'high')], DEFAULT_RULE).length, 0)
  })
  test('past SLA with no owner goes — the queue failing, not a case', () => {
    assert.equal(selectForDelivery([mk('4', 'medium', { ageH: 200 })], DEFAULT_RULE).length, 1)
  })
  test('past SLA but owned does not — somebody has it', () => {
    assert.equal(
      selectForDelivery([mk('5', 'medium', { ageH: 200, assignee: 'u-rohit' })], DEFAULT_RULE).length, 0)
  })
  test('closed cases never go', () => {
    for (const status of ['resolved', 'dismissed']) {
      assert.equal(selectForDelivery([mk('6', 'critical', { status })], DEFAULT_RULE).length, 0)
    }
  })
  test('never the same case twice', () => {
    const told = mk('7', 'critical', {
      activity: [{ id: 'x', ts: '', actor: 'system', kind: 'notified', detail: '' }],
    })
    assert.equal(wasNotified(told), true)
    assert.equal(selectForDelivery([told], DEFAULT_RULE).length, 0)
  })
  test('worst and largest first', () => {
    const out = selectForDelivery(
      [mk('a', 'critical', { value: 10 }), mk('b', 'critical', { value: 99 })], DEFAULT_RULE)
    assert.equal(out[0].signalId, 'b')
  })
})

describe('buildPayload', () => {
  const many = Array.from({ length: 25 }, (_, i) => mk(`m${i}`, 'critical', { value: i }))
  const p = buildPayload(selectForDelivery(many, DEFAULT_RULE), DEFAULT_RULE, 'https://x.app')

  test('caps the list and counts the rest', () => {
    assert.equal(p.cases.length, DEFAULT_RULE.max)
    assert.equal(p.omitted, 25 - DEFAULT_RULE.max)
    assert.match(p.text, /and 15 more/)
  })
  test('every line carries the action', () => {
    const actions = p.text.split('\n').filter((l) => l.trim().startsWith('→'))
    assert.equal(actions.length, p.cases.length)
  })
  test('carries provenance, so a reader can challenge it', () => {
    assert.deepEqual(p.cases[0].sources, ['VAHAN/01'])
  })
  test('links back to the consignment', () => {
    assert.match(p.cases[0].url ?? '', /^https:\/\/x\.app\/#\/shipments\?q=CN/)
  })
  test('omits the link rather than inventing a host', () => {
    const noUrl = buildPayload(selectForDelivery(many, DEFAULT_RULE), DEFAULT_RULE)
    assert.equal(noUrl.cases[0].url, null)
  })
})
