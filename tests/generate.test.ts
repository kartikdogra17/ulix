/* The generated world. Regression: status and timetable were drawn from
   separate distributions and never reconciled, so a consignment could be
   'planned' with a departure three weeks in the past, and most undelivered
   consignments carried an ETA already behind the clock — which made every
   comparison against `eta` a comparison about nothing. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeShipments, makeVehicles, makeDocs } from '../src/data/mock/generate'

const ships = makeShipments()
const NOW = Date.now()

describe('makeShipments', () => {
  test('the timetable agrees with the status', () => {
    for (const s of ships) {
      const dep = Date.parse(s.legs[0].plannedDep)
      const arr = Date.parse(s.legs[s.legs.length - 1].plannedArr)
      if (s.status === 'planned') {
        assert.ok(dep > NOW, `${s.id} is planned but departed already`)
      } else if (s.status === 'delivered') {
        assert.ok(arr <= NOW, `${s.id} is delivered but arrives in the future`)
      } else {
        assert.ok(dep <= NOW && arr >= NOW, `${s.id} is ${s.status} but now is outside its journey`)
      }
    }
  })

  test('no pending leg has a departure already past', () => {
    for (const s of ships) {
      for (const l of s.legs) {
        if (l.status === 'pending') {
          assert.ok(Date.parse(l.plannedDep) > NOW, `${s.id} ${l.id} was due to leave already`)
        }
      }
    }
  })

  test('nothing is created after its own departure, or in the future', () => {
    for (const s of ships) {
      const created = Date.parse(s.createdAt)
      assert.ok(created <= Date.parse(s.legs[0].plannedDep))
      assert.ok(created <= NOW, `${s.id} was raised in the future`)
    }
  })

  test('undelivered consignments have an ETA ahead of them', () => {
    const behind = ships.filter((s) => s.status !== 'delivered' && Date.parse(s.eta) < NOW)
    assert.equal(behind.length, 0, `${behind.length} undelivered consignments have an ETA in the past`)
  })

  test('the status mix is a spread, not one value', () => {
    const mix = new Set(ships.map((s) => s.status))
    assert.ok(mix.size >= 4, 'a book that is all one status exercises nothing')
  })

  test('deterministic — the same world every reload', () => {
    assert.deepEqual(makeShipments().map((s) => s.id), ships.map((s) => s.id))
  })
})

describe('the world hangs together', () => {
  const vehicles = makeVehicles(ships)
  const docs = makeDocs(ships, vehicles)

  test('every moving consignment has a vehicle beneath it', () => {
    const moving = ships.filter((s) => s.status === 'in_transit')
    const withVehicle = moving.filter((s) => vehicles.some((v) => v.shipmentId === s.id))
    assert.ok(withVehicle.length / moving.length > 0.5,
      'most in-transit consignments should resolve to a vehicle, or the cross-system picture is hollow')
  })

  test('documents point at things that exist', () => {
    const ids = new Set(ships.map((s) => s.id))
    const regs = new Set(vehicles.map((v) => v.regNo))
    for (const d of docs) {
      const known = d.linkedKind === 'shipment' ? ids.has(d.linkedTo) : regs.has(d.linkedTo)
      assert.ok(known, `${d.id} points at ${d.linkedTo}, which does not exist`)
    }
  })
})
