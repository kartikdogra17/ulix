/* The role lens. It is a lens, not access control — the tests assert both
   halves: that it genuinely changes what leads, and that it hides nothing. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { lensFor, rankForRole, ownership, MODULE_LABEL } from '../src/data/roles'
import type { Role } from '../src/data/roles'
import type { Case } from '../src/data/cases'

const ROLES: Role[] = ['Shipper', 'Transporter', 'Freight Forwarder', 'Regulator']
const mk = (kind: string, sev: 'critical' | 'high' | 'medium'): Case => ({
  signalId: kind, status: 'open', assignee: null, snoozedUntil: null, resolution: null,
  updatedAt: '', activity: [], isDue: false,
  signal: { id: kind, kind, severity: sev, title: '', detail: '', sources: [],
    entity: 'CN1', entityKind: 'shipment', valueAtRisk: 1, hoursToAct: null,
    detectedAt: '', action: '' },
} as unknown as Case)

describe('the lens', () => {
  test('every role names every module it advertises', () => {
    for (const role of ROLES) {
      for (const path of lensFor(role).nav) {
        assert.ok(MODULE_LABEL[path], `${role} advertises ${path} with no name`)
      }
    }
  })

  test('the four phone tabs are all advertised to that role', () => {
    for (const role of ROLES) {
      const lens = lensFor(role)
      for (const p of lens.mobilePrimary) assert.ok(lens.nav.includes(p))
    }
  })

  test('a kind is never both this role\'s problem and not', () => {
    for (const role of ROLES) {
      const lens = lensFor(role)
      for (const k of lens.primaryKinds) assert.ok(!lens.mutedKinds.includes(k))
    }
  })

  test('the roles genuinely differ, or the lens is decoration', () => {
    const headlines = new Set(ROLES.map((r) => lensFor(r).headline([], null).label))
    assert.ok(headlines.size >= 3, 'roles should not mostly share a headline')
    const towers = new Set(ROLES.map((r) => lensFor(r).towerTitle))
    assert.equal(towers.size, 4)
  })

  test('the regulator is never shown cargo value — they own none of it', () => {
    const lens = lensFor('Regulator')
    assert.ok(!lens.pageDefaults.shipments.columns.includes('value'))
    assert.doesNotMatch(lens.headline([], null).value, /₹/)
    assert.ok(!lens.pageDefaults.fleet.columns.includes('utilisation'),
      'utilisation is commercial, not a compliance matter')
  })
})

describe('rankForRole', () => {
  test('a medium this role owns outranks a critical it does not', () => {
    const lens = lensFor('Regulator')
    assert.equal(ownership(lens, 'fitness_lapsed'), 'primary')
    assert.equal(ownership(lens, 'eta_slip'), 'muted')
    const out = rankForRole(lens, [mk('eta_slip', 'critical'), mk('fitness_lapsed', 'medium')])
    assert.equal(out[0].signalId, 'fitness_lapsed')
  })

  test('nothing is removed — being wrong about a remit costs a scroll', () => {
    const lens = lensFor('Regulator')
    const input = [mk('eta_slip', 'critical'), mk('fitness_lapsed', 'medium'), mk('detention', 'high')]
    assert.equal(rankForRole(lens, input).length, input.length)
  })

  test('within a band, severity still leads', () => {
    const lens = lensFor('Transporter')
    const out = rankForRole(lens, [mk('fitness_lapsed', 'medium'), mk('dl_expired', 'critical')])
    assert.equal(out[0].signal.severity, 'critical')
  })
})
