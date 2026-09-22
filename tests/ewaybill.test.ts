/* EWAYBILL/01. Every value here is copied verbatim from the response
   sample in ULIP_EWAYBILL_Integration_Requirement — including the
   inconsistent types and the validUpto that carries no date. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ewbDate, toEwayBill, type EwayBillRecord } from '../src/data/ulip/map'

/** The documented success response, unedited. */
const SAMPLE: EwayBillRecord = {
  fromPincode: 301404,
  hsnCode: '',
  ewayBillDate: '29/11/2017 04:30:00 PM',
  validUpto: ' 11:59:00 PM',
  ewbNo: 101000609218,
  toPincode: 302014,
  VehiclListDetails: [
    { vehicleNo: 'RJ14CG4508', enteredDate: '29/11/2017 04:30:00 PM', transMode: '1' },
  ],
  status: 'ACT',
}

describe('ewbDate', () => {
  test('dd/MM/yyyy, never read as MM/dd', () => {
    // Date.parse("05/11/2017") says 5 May. The field means 5 November, and
    // it is only wrong for the first twelve days of each month — the worst
    // possible pattern to notice.
    assert.equal(ewbDate('05/11/2017 04:30:00 PM')?.slice(0, 10), '2017-11-05')
    assert.equal(ewbDate('29/11/2017 04:30:00 PM')?.slice(0, 10), '2017-11-29')
  })

  test('12-hour clock is converted, both ends of the day', () => {
    assert.equal(ewbDate('01/01/2024 12:00:00 AM')?.slice(11, 19), '00:00:00')
    assert.equal(ewbDate('01/01/2024 12:00:00 PM')?.slice(11, 19), '12:00:00')
    assert.equal(ewbDate('01/01/2024 04:30:00 PM')?.slice(11, 19), '16:30:00')
  })

  test('a time with no date is not a date', () => {
    assert.equal(ewbDate(' 11:59:00 PM'), null)
    assert.equal(ewbDate('11:59 PM'), null)
  })
})

describe('toEwayBill', () => {
  const m = toEwayBill(SAMPLE)

  test('absorbs the gateway disagreeing with itself on types', () => {
    // ewbNo is a string in the request and a number in the response.
    assert.equal(m.known.ewbNo, '101000609218')
    assert.equal(m.known.fromPincode, '301404')
    assert.equal(m.known.toPincode, '302014')
  })

  test('decodes the abbreviations rather than passing them through', () => {
    assert.equal(m.known.status, 'active')
    assert.equal(m.known.partB[0].mode, 'road')
  })

  test('Part-B is the vehicle the bill declares — the join for a mismatch', () => {
    assert.equal(m.known.partB.length, 1)
    assert.equal(m.known.partB[0].vehicleNo, 'RJ14CG4508')
    assert.equal(m.known.partB[0].enteredAt?.slice(0, 10), '2017-11-29')
  })

  test('an empty hsnCode is absent, not an empty string', () => {
    assert.equal(m.known.hsnCode, undefined)
  })

  test('THE FINDING: validUpto carries no date, so expiry is unusable', () => {
    // The flagship signal compares this against a movement-derived ETA.
    // The documented sample cannot support that comparison.
    assert.equal(m.known.validUpto, undefined)
    assert.ok(m.missing.includes('validUpto'))
    assert.match(m.warnings[0], /cannot be compared against an ETA/)
  })

  test('the date is never inferred from the issue date', () => {
    // Guessing it would fabricate a statutory expiry — the same class of
    // bug already paid for once on VAHAN dates.
    assert.notEqual(m.known.validUpto, m.known.issuedAt)
    assert.equal(m.known.validUpto, undefined)
  })

  test('a full validUpto maps cleanly when the gateway sends one', () => {
    const full = toEwayBill({ ...SAMPLE, validUpto: '30/11/2017 11:59:00 PM' })
    assert.equal(full.known.validUpto?.slice(0, 10), '2017-11-30')
    assert.equal(full.warnings.length, 0)
    assert.ok(!full.missing.includes('validUpto'))
  })

  test('an unknown status is flagged, not silently dropped', () => {
    const odd = toEwayBill({ ...SAMPLE, status: 'XYZ' })
    assert.equal(odd.known.status, undefined)
    assert.match(odd.warnings.join(' '), /Unknown e-Way Bill status/)
  })

  test('an empty record yields nothing invented', () => {
    const empty = toEwayBill({})
    assert.deepEqual(empty.known.partB, [])
    assert.equal(empty.known.ewbNo, undefined)
  })
})
