/* Gateway records → domain model. The date case is a regression: parsing
   "25-Jan-2032" through Date.parse succeeds as LOCAL midnight, and
   toISOString then walks it back a day in any positive offset — so in IST a
   fitness certificate expired a day before it really did. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { vahanDate, normBs, normFuel, geocode, toVehicle } from '../src/data/ulip/map'

describe('vahanDate', () => {
  test('dd-MMM-yyyy is a calendar date, pinned to UTC', () => {
    assert.equal(vahanDate('25-Jan-2032')?.slice(0, 10), '2032-01-25')
    assert.equal(vahanDate('15-Sep-2020')?.slice(0, 10), '2020-09-15')
    assert.equal(vahanDate('01-Dec-2024')?.slice(0, 10), '2024-12-01')
  })
  test('empty and unparseable yield null rather than a plausible date', () => {
    for (const bad of ['', undefined, 'not a date', 'NA']) {
      assert.equal(vahanDate(bad as string | undefined), null)
    }
  })
})

describe('normalisers', () => {
  test('BHARAT STAGE III is not read as II', () => {
    // Substring matching in the wrong order downgrades a III to a II.
    assert.equal(normBs('BHARAT STAGE III'), 'BS-III')
    assert.equal(normBs('BHARAT STAGE II'), 'BS-II')
    assert.equal(normBs('BHARAT STAGE VI'), 'BS-VI')
  })
  test('PETROL exists in the real data', () => {
    assert.equal(normFuel('PETROL'), 'Petrol')
    assert.equal(normFuel('DIESEL'), 'Diesel')
  })
  test('unknown values are null, not guessed', () => {
    assert.equal(normBs('???'), null)
    assert.equal(normFuel('PLUTONIUM'), null)
  })
  test('geocode splits the documented format', () => {
    assert.deepEqual(geocode('11.0001,11.0001'), { lat: 11.0001, lon: 11.0001 })
    assert.equal(geocode('rubbish'), null)
  })
})

describe('toVehicle', () => {
  test('an omitted field is reported missing, never filled in', () => {
    const { known, missing } = toVehicle('UP91L0001', {
      rcRegnNo: 'UP91L0001', rcPuccUpto: '', rcBlacklistStatus: '',
    }, [])
    assert.equal(known.pucUpto, undefined)
    assert.ok(missing.includes('pucUpto'))
    assert.ok(missing.includes('tagStatus'))
  })
  test('declares what ULIP cannot supply at all', () => {
    const { gaps } = toVehicle('X', { rcRegnNo: 'X' }, [])
    for (const f of ['permitUpto', 'tagBalance', 'driverName']) assert.ok(gaps.includes(f as never))
  })
})
