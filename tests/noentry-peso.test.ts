/* NOENTRY/01 and PESO/01, plus the catalogue's own self-consistency.
   Values copied verbatim from the integration documents, including the
   clock written with dots, the prose sentinel inside a typed field, and
   the endpoint that cannot answer the signal citing it. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD_GAPS, inNoEntryWindow, istMinutesOfDay, noEntryWindow, pesoFound, pesoMiss,
  toNoEntry, toPesoCylinders, PESO_UNAVAILABLE,
  type NoEntryRecord, type PesoRecord,
} from '../src/data/ulip/map'
import { ULIP_ENDPOINTS, SPEC_CONFLICTS, endpointById } from '../src/data/ulip/catalogue'

/** NOENTRY/01, the documented success sample. */
const ZONES: NoEntryRecord[] = [
  {
    noEntryTime: '8.00 AM to 10.00 PM', districtCode: 1, districtName: 'UPD- BBSR',
    stateName: 'Odisha', areaName: 'NH-203 Bypass Pandara Chowk to Rasulgarh VIa\nGGP Colony',
    stateCode: 21,
  },
  {
    noEntryTime: '8.00 AM to 10.00 PM', districtCode: 1, districtName: 'UPD- BBSR',
    stateName: 'Odisha', areaName: 'NH-203 Bypass Kesura Square to Jharpada', stateCode: 21,
  },
]

/** PESO/01, the documented "vehicle exists" sample. Two cylinders. */
const CYL: PesoRecord = {
  ErrorMsg: '',
  'Cylinder Manufacturing Date': '01/10/2021',
  'Cylinder Make': 'M/s. Zhejiang Jindun Pressure Vessel Co. Ltd., China',
  'Cylinder capacity in water litre': 150.0,
  'Number of cylinders': 'Not Available at PESO',
  'Cylinder ID/ Serial Number': 'K-6834833',
  'Hydro Test Date': '26/12/2025',
  'Hydro Test Due Date': '25/12/2028',
  'Test Result': 'Pass',
  'Cylinder Age valid till Date': 'Not Available at PESO',
  'Testing Company Name': 'MAHADEV CNG CYLINDER TESTING COMPANY',
  'Certificate No': 'G145658/2025/2579',
  'Vehicle Registration Number': 'HR38AC7120',
}
const CYL2: PesoRecord = {
  ...CYL,
  'Cylinder ID/ Serial Number': 'K-6834166',
  'Certificate No': 'G145658/2025/2580',
}

describe('no-entry windows are written with dots, not colons', () => {
  test('the documented form', () => {
    const w = noEntryWindow('8.00 AM to 10.00 PM')
    assert.deepEqual(
      { fromMin: w!.fromMin, toMin: w!.toMin, wraps: w!.wraps },
      { fromMin: 480, toMin: 1320, wraps: false })
    assert.equal(w!.label, '08:00–22:00 IST')
  })
  test('tolerates colons, a bare hour, and other separators', () => {
    assert.equal(noEntryWindow('8:00 AM to 10:00 PM')?.fromMin, 480)
    assert.equal(noEntryWindow('8 AM to 10 PM')?.fromMin, 480)
    assert.equal(noEntryWindow('8.00 AM - 10.00 PM')?.toMin, 1320)
  })
  test('noon and midnight are the cases a 12-hour clock gets wrong', () => {
    assert.equal(noEntryWindow('12.00 PM to 1.00 PM')?.fromMin, 720)
    assert.equal(noEntryWindow('12.00 AM to 1.00 AM')?.fromMin, 0)
  })
  test('refuses what it cannot read rather than half-reading it', () => {
    for (const bad of ['', 'at night', '8.00 to 10.00', '25.00 AM to 2.00 PM', 'always']) {
      assert.equal(noEntryWindow(bad), null)
    }
  })
})

describe('a no-entry window must not fail open', () => {
  const night = noEntryWindow('10.00 PM to 6.00 AM')!
  const day = noEntryWindow('8.00 AM to 10.00 PM')!

  test('THE TRAP: a night ban wraps midnight', () => {
    // A city-centre ban is typically 22:00-06:00, where toMin < fromMin. A
    // naive `from <= t && t <= to` is false at EVERY minute of such a
    // window, so the ban silently never applies and a truck is waved in at
    // 2am. This is the ncrEligibility fail-open with a clock instead of an
    // emission norm.
    assert.equal(night.wraps, true)
    const twoAmIst = Date.UTC(2025, 11, 31, 20, 30) // 02:00 IST, 1 Jan
    assert.equal(inNoEntryWindow(night, twoAmIst), true)
    // What the naive comparison would have concluded:
    assert.equal(night.fromMin <= 120 && 120 < night.toMin, false)
  })
  test('and still excludes what is genuinely outside it', () => {
    const noonIst = Date.UTC(2026, 0, 1, 6, 30)
    assert.equal(inNoEntryWindow(night, noonIst), false)
    assert.equal(inNoEntryWindow(day, noonIst), true)
  })
  test('equal bounds are read as all day, not as zero length', () => {
    // The field is a restriction; the safe reading of an ambiguous one is
    // the restrictive one.
    const w = noEntryWindow('6.00 AM to 6.00 AM')!
    assert.equal(inNoEntryWindow(w, Date.UTC(2026, 0, 1, 6, 30)), true)
    assert.equal(inNoEntryWindow(w, Date.UTC(2026, 0, 1, 18, 30)), true)
  })
  test('THE TRAP: the window is IST and the server is not', () => {
    // A ban stated in local civil time, evaluated against UTC hours, is
    // 5.5 hours out. Asserted across zones so it cannot pass by accident
    // on the Asia/Kolkata laptop this was written on.
    const tz = process.env.TZ
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
        process.env.TZ = zone
        // 20:30 UTC = 02:00 IST next day.
        assert.equal(istMinutesOfDay(Date.UTC(2025, 11, 31, 20, 30)), 120, `TZ=${zone}`)
        assert.equal(inNoEntryWindow(night, Date.UTC(2025, 11, 31, 20, 30)), true, `TZ=${zone}`)
        assert.equal(inNoEntryWindow(day, Date.UTC(2026, 0, 1, 6, 30)), true, `TZ=${zone}`)
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz
    }
  })
})

describe('toNoEntry', () => {
  const m = toNoEntry(ZONES)
  test('THE TRAP: an empty answer is not "no restrictions"', () => {
    // The document publishes no not-found sample, so the empty case is
    // undocumented. Reading it as clear-to-enter is the GRAP fail-open.
    const none = toNoEntry([])
    assert.deepEqual(none.known.zones, [])
    assert.ok(none.missing.includes('zones'))
    assert.match(none.warnings.join(' '), /NOT the same as the state having no restrictions/)
  })
  test('areaName carries embedded newlines that break a table row', () => {
    assert.equal(m.known.zones[0].area,
      'NH-203 Bypass Pandara Chowk to Rasulgarh VIa GGP Colony')
    assert.ok(!m.known.zones.some((z) => /\n/.test(z.area)))
  })
  test('stateCode is a number in the response and a string in the request', () => {
    assert.equal(m.known.zones[0].stateCode, '21')
    assert.equal(m.known.zones[0].districtCode, '1')
  })
  test('the raw window is kept alongside the parse', () => {
    assert.equal(m.known.zones[0].rawWindow, '8.00 AM to 10.00 PM')
  })
  test('an unreadable window leaves the restriction standing', () => {
    const odd = toNoEntry([{ ...ZONES[0], noEntryTime: 'during festivals' }])
    assert.equal(odd.known.zones.length, 1)
    assert.equal(odd.known.zones[0].window, null)
    assert.match(odd.warnings.join(' '), /The restriction stands/)
  })
  test('identical rows are deduplicated, different areas are not', () => {
    assert.equal(toNoEntry([ZONES[0], ZONES[0]]).known.zones.length, 1)
    assert.equal(m.known.zones.length, 2)
  })
})

describe('PESO prose sentinels sit inside typed fields', () => {
  test('"Not Available at PESO" is recognised', () => {
    assert.equal(PESO_UNAVAILABLE.test('Not Available at PESO'), true)
    assert.equal(PESO_UNAVAILABLE.test('Pass'), false)
  })
  test('THE TRAP: it would become NaN in a number and a sentence in a date', () => {
    assert.ok(Number.isNaN(Number('Not Available at PESO')))
    const m = toPesoCylinders([CYL])
    // Neither leaks through as a value.
    assert.equal(m.known.cylinders[0].ageValidUpto, undefined)
    assert.equal(m.known.cylinderCount, 1)
    assert.match(m.warnings.join(' '), /number of certificates returned/)
  })
})

describe('toPesoCylinders', () => {
  const m = toPesoCylinders([CYL, CYL2])
  test('one vehicle, many cylinders, counted from the rows', () => {
    assert.equal(m.known.cylinderCount, 2)
    assert.equal(m.known.regNo, 'HR38AC7120')
    assert.deepEqual(m.known.cylinders.map((c) => c.serialNo), ['K-6834833', 'K-6834166'])
  })
  test('dd/MM/yyyy, the e-Way Bill trap again', () => {
    // 01/10/2021 is 1 October, not 10 January.
    assert.equal(m.known.cylinders[0].manufacturedOn, '2021-10-01T00:00:00.000Z')
    assert.equal(m.known.cylinders[0].testedOn, '2025-12-26T00:00:00.000Z')
    assert.equal(m.known.cylinders[0].dueOn, '2028-12-25T00:00:00.000Z')
  })
  test('THE TRAP: the EARLIEST due date governs the vehicle', () => {
    // A vehicle is out of certification as soon as ONE cylinder lapses.
    // Taking the first row's date, or the latest, certifies a vehicle that
    // is not certified.
    const mixed = toPesoCylinders([CYL, { ...CYL2, 'Hydro Test Due Date': '01/02/2026' }])
    assert.equal(mixed.known.earliestDueOn, '2026-02-01T00:00:00.000Z')
    assert.notEqual(mixed.known.earliestDueOn, mixed.known.cylinders[0].dueOn)
  })
  test('an unreadable test result is not a pass', () => {
    assert.equal(m.known.cylinders[0].testPassed, true)
    assert.equal(
      toPesoCylinders([{ ...CYL, 'Test Result': 'Not Available at PESO' }])
        .known.cylinders[0].testPassed, undefined)
    assert.equal(
      toPesoCylinders([{ ...CYL, 'Test Result': 'Fail' }]).known.anyTestFailed, true)
  })
  test('THE TRAP: a miss is one row carrying only ErrorMsg, under SUCCESS', () => {
    // The fifth shape ULIP uses for a miss. On a hit ErrorMsg is "", on a
    // record-level miss it is prose, and on a FIELD-level miss the prose
    // goes in the field instead.
    assert.equal(pesoMiss({ ErrorMsg: 'No Record found' }), true)
    assert.equal(pesoMiss(CYL), false)
    assert.equal(pesoFound([{ ErrorMsg: 'No Record found' }]), false)
    assert.equal(pesoFound([CYL]), true)
    const miss = toPesoCylinders([{ ErrorMsg: 'No Record found' }])
    assert.equal(miss.known.cylinderCount, 0)
    assert.match(miss.warnings.join(' '), /only covers CNG cylinder testing/)
  })
})

describe('PESO/01 cannot answer the hazmat signal', () => {
  test('the gap is declared, not quietly left as a TODO', () => {
    // PESO is the Petroleum & Explosives Safety Organisation, but the one
    // endpoint ULIP exposes from it returns CNG cylinder certificates. The
    // word "explosive" appears in none of the 36 documents, and no
    // document declares a licence field of any kind.
    assert.ok('hazmatClearance' in FIELD_GAPS)
    assert.match(FIELD_GAPS.hazmatClearance, /CNG CYLINDER TEST CERTIFICATES/)
  })
})

describe('the catalogue must agree with itself', () => {
  test('every documented example satisfies its documented format', () => {
    // This is the check that was missing while 42 regexes were
    // double-escaped (`\\d`, matching a literal backslash) and six
    // stateCode parameters carried an example their own format rejects.
    const bad: string[] = []
    for (const ep of ULIP_ENDPOINTS) {
      for (const p of ep.params) {
        if (!p.format || !p.example) continue
        if (`${ep.id} ${p.name}` in SPEC_CONFLICTS) continue
        let ok = false
        try { ok = new RegExp(p.format).test(p.example) } catch { ok = false }
        if (!ok) bad.push(`${ep.id} ${p.name}: ${p.example} vs ${p.format}`)
      }
    }
    assert.deepEqual(bad, [])
  })
  test('no format carries a doubled backslash', () => {
    const doubled = ULIP_ENDPOINTS.flatMap((e) => e.params)
      .filter((p) => p.format?.includes('\\\\'))
    assert.deepEqual(doubled, [])
  })
  test('THE TRAP: stateCode is numeric on some endpoints and letters on others', () => {
    // Six endpoints, one parameter name, two incompatible formats. Passing
    // 21 to IOCL/02 earns a 400; passing WB to NOENTRY/01 earns another.
    const noEntry = endpointById('NOENTRY/01')!.params.find((p) => p.name === 'stateCode')!
    const iocl = endpointById('IOCL/02')!.params.find((p) => p.name === 'stateCode')!
    assert.equal(noEntry.format, '^\\d{1,5}$')
    assert.equal(noEntry.example, '21')
    assert.equal(iocl.format, '^[A-Z]{1,6}$')
    assert.equal(iocl.example, 'WB')
    assert.equal(new RegExp(iocl.format!).test(noEntry.example), false)
    assert.equal(new RegExp(noEntry.format!).test(iocl.example), false)
  })
  test('the truncated regexes were restored whole', () => {
    for (const id of ['MCA/03', 'MCA/04']) {
      const cin = endpointById(id)!.params.find((p) => p.name === 'cin')!
      assert.ok(new RegExp(cin.format!).test('U01100AP2018PTC107442'), id)
    }
    for (const id of ['SARATHI/01', 'SARATHI/02', 'TGSARATHI/01']) {
      const dl = endpointById(id)!.params.find((p) => p.name === 'dlnumber')!
      assert.ok(new RegExp(dl.format!).test('GJ04 20120005008'), id)
    }
  })
})
