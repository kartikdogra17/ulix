/* FOIS/01 and ICEGATE/02. Values copied verbatim from the integration
   documents, including the two formats that no general date parser
   handles and the "not found" that reports itself as SUCCESS. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  foisDate, splitStation, toRake, icegateDate, toBoe, boeFound,
  type FoisRecord, type BoeRecord,
} from '../src/data/ulip/map'

/** FOIS/01, from ULIP_FOIS_Integration_Requirement. */
const RAKE: FoisRecord = {
  newFnr: '',
  etaDstn: '22:10 20-09-2023',
  cmdt: 'PHC',
  currentStatus: 'REACHED AT DESTINATION ON 22:10 20-09-2023',
  lastRepStts: 'AR',
  locoNumb: '',
  lastRepLocn: 'M/S NABHA POWER LTD.SIDING(NPSB)',
  lgtd: '76.515312',
  fnrNo: '23091420258',
  lttd: '30.538016',
  stationFrom: 'NEW KUSMUNDA COLLIERY SIDING,  KORBA(NKCR)',
  stationTo: 'M/S NABHA POWER LTD.SIDING(NPSB)',
}

/** ICEGATE/02 boeDetails, from ULIP_ICEGATE_Integration_Requirement. */
const BOE: BoeRecord = {
  imoCode: '1000000',
  containerNo: ['MSCU7786602'],
  unitOfQt: 'MTS',
  igmDt: '04072011',
  natureOfCargo: 'C',
  countryOrig: 'BR',
  grossWt: 25.99,
  totNoPkg: 56,
}

describe('FOIS dates put the time first', () => {
  test('HH:mm dd-MM-yyyy', () => {
    assert.equal(foisDate('22:10 20-09-2023'), '2023-09-20T22:10:00.000Z')
    assert.equal(foisDate('09:05 01-02-2024')?.slice(0, 16), '2024-02-01T09:05')
  })
  test('rejects anything else rather than half-reading it', () => {
    for (const bad of ['20-09-2023', '22:10', '2023-09-20', '']) {
      assert.equal(foisDate(bad), null)
    }
  })
})

describe('station names carry their code in brackets', () => {
  test('splits name from code and tidies the spacing', () => {
    assert.deepEqual(splitStation('NEW KUSMUNDA COLLIERY SIDING,  KORBA(NKCR)'),
      { name: 'NEW KUSMUNDA COLLIERY SIDING, KORBA', code: 'NKCR' })
  })
  test('a name with no code still yields a name', () => {
    assert.deepEqual(splitStation('SOMEWHERE'), { name: 'SOMEWHERE', code: null })
  })
})

describe('toRake', () => {
  const m = toRake(RAKE)
  test('latitude and longitude are not swapped', () => {
    // The gateway lists lgtd before lttd, and both are strings. Reading them
    // out in the order they appear puts the rake in the Indian Ocean.
    assert.deepEqual(m.known.position, { lat: 30.538016, lon: 76.515312 })
  })
  test('decodes the status abbreviation', () => {
    assert.equal(m.known.status, 'AR')
    assert.equal(m.known.statusLabel, 'Arrived')
  })
  test('falls back to fnrNo when newFnr is empty', () => {
    assert.equal(m.known.fnr, '23091420258')
  })
  test('parses the ETA the flagship rail leg depends on', () => {
    assert.equal(m.known.eta?.slice(0, 10), '2023-09-20')
  })
  test('resolves both ends to a station code', () => {
    assert.equal(m.known.from?.code, 'NKCR')
    assert.equal(m.known.to?.code, 'NPSB')
  })
  test('an empty record reports what is missing', () => {
    const empty = toRake({})
    assert.ok(empty.missing.includes('position'))
    assert.ok(empty.missing.includes('eta'))
    assert.equal(empty.known.position, undefined)
  })
})

describe('ICEGATE dates have no separators at all', () => {
  test('ddMMyyyy', () => {
    assert.equal(icegateDate('04072011')?.slice(0, 10), '2011-07-04')
    assert.equal(icegateDate('16072011')?.slice(0, 10), '2011-07-16')
  })
  test('an impossible date is rejected, not rolled into the next month', () => {
    assert.equal(icegateDate('31022011'), null)
    assert.equal(icegateDate('00012011'), null)
  })
  test('rejects other shapes', () => {
    for (const bad of ['4072011', '04-07-2011', '']) assert.equal(icegateDate(bad), null)
  })
})

describe('toBoe', () => {
  const m = toBoe(BOE)
  test('containers are always a list, even for one box', () => {
    assert.deepEqual(m.known.containers, ['MSCU7786602'])
  })
  test('decodes the cargo nature code', () => {
    assert.equal(m.known.natureOfCargo, 'C')
    assert.equal(m.known.natureLabel, 'Containerised')
  })
  test('keeps the numbers as numbers', () => {
    assert.equal(m.known.grossWeight, 25.99)
    assert.equal(m.known.packages, 56)
    assert.equal(m.known.unit, 'MTS')
  })
  test('THE TRAP: an unknown BE is SUCCESS with an empty list', () => {
    // isNotFound() will not catch this — the envelope says SUCCESS. A caller
    // checking only that reads "no such bill of entry" as a good lookup.
    assert.equal(boeFound([]), false)
    assert.equal(boeFound(undefined), false)
    assert.equal(boeFound([BOE]), true)
  })
})
