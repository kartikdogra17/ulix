/* PCS/01 and LDB/01. Values copied verbatim from the integration
   documents, including the third shape ULIP uses to report a miss, the
   fifth date format, and the timestamp that is only wrong off Indian
   soil. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isMasked, ldbEventTime, ldbTrail, pcsEtaDate, pcsFound, pcsMiss, toLdb, toPcs,
  type LdbRecord, type PcsRecord,
} from '../src/data/ulip/map'
import { isNotFound } from '../src/data/ulip/envelope'

/** PCS/01, the "IGM number exists" sample. */
const PCS: PcsRecord = {
  voyage_no: '909E', bill_date: '30012023', port_of_arrival: 'INMUN1',
  goods_description: 'P*A*T*C*R*G*I*D*H* *O*E*3*0*1*9* *5*(*I*T* *I*E* *A*K*G*S',
  port_of_loading: 'JPYOK', bill_no: '010DW06169', total_no_of_packages: '29',
  mode_of_transport: null, sub_line_number: '0', container_seal_no: 'WHLU045961',
  line_number: '40', container_no: 'WHSU6942383', number_of_packages: '55',
  container_weight: 25.65, terminal_operator_code: 'INMUN1MCT1', nature_of_cargo: 'C',
  responseMsg: 'SUCCESS', shipping_line_code: 'AAFCT5861J', port_of_destination: 'INMUN1',
  line_no: '40', custom_house_code: 'INMUN1', grossWeight: 50847,
  expected_date_and_time_of_arrival: '02032023:21:18', sub_line_no: '0',
  igm_date: '27022023', shipping_agent_code: 'AAFCT5861J', cargo_imo_code: 'ZZZ',
  igm_no: '2336612', iso_code: '4410', port_of_discharge: 'INMUN1SMS1',
}

/** PCS/01, the "IGM number does not exist" sample. Note responseStatus:
    SUCCESS in the envelope around it, and a record that is entirely null. */
const PCS_MISS: PcsRecord = {
  custom_house_code: null, igm_no: null, igm_date: null, voyage_no: null,
  shipping_line_code: null, shipping_agent_code: null, port_of_arrival: null,
  expected_date_and_time_of_arrival: null, terminal_operator_code: null,
  cargo_imo_code: null, line_no: null, sub_line_no: null, bill_no: null, bill_date: null,
  port_of_loading: null, port_of_destination: null, nature_of_cargo: null,
  port_of_discharge: null, grossWeight: null, number_of_packages: null,
  goods_description: null, mode_of_transport: null, container_no: null, line_number: null,
  sub_line_number: null, container_seal_no: null, total_no_of_packages: null,
  container_weight: null, iso_code: null, responseMsg: 'not found',
}

const EVENT_OUT = {
  serialno: 1, eventname: 'PORT OUT',
  currentlocation: 'Raigad/Nhava Sheva Freeport Terminal (NSFT)', division: null,
  timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'IST',
  latitude: 18.950149, longitude: 72.95123, containernumber: 'NSST1234570',
  timeinms: 1680067809000, transportmode: 'TRUCK', type: 'I', isempty: 'Y',
}
const EVENT_IN = {
  serialno: 2, eventname: 'PORT IN',
  currentlocation: 'Raigad/Nhava Sheva Freeport Terminal (NSFT)', division: null,
  timestamptimezone: '2023-03-28 09:00:08', timezoneabvr: 'IST',
  latitude: 18.950149, longitude: 72.95123, containernumber: 'NSST1234570',
  timeinms: 1679974208000, transportmode: 'VESSEL', type: 'I', isempty: 'Y',
}

/** LDB/01, the "container number exists" sample. */
const LDB: LdbRecord = {
  eximContainerTrail: {
    cntrDetail: { cntrno: 'NSST1234570', refflg: 'Yes', cntrsize: 40, isocode: '22G3', containertype: null },
    dpd_dpe: { c_import: { dpd: 'N', destination: null }, c_export: null },
    last_event: [EVENT_OUT],
    res_Message: 'Success',
    // As documented: numbered ascending, ordered NEWEST first.
    trackLog: [EVENT_OUT, EVENT_IN],
    vessel_ata: null, vessel_atd: null,
    vessel_eta: [{
      eventid: 24, infotime: 1680659629000, eventname: 'EXPECTED VESSEL ARRIVAL',
      orgname: 'Nhava Sheva Freeport Terminal (NSFT)', timeinms: 1679978002000,
      timetimestamp: '2023-03-28 10:03:22', latitude: null, longitude: null,
      vesselname: 'APR EXPRESSS', vesselimo: null, cntrcycleid: 1,
      shippingline: 'TRANSPORT CORPORATION OF INDIA LTD',
    }],
    vessel_etd: null, vessel_gate_cutoff: null,
  },
  domesticContainerTrail: {
    cntrDetail: null, dpd_dpe: null, last_event: null, res_Message: 'NO RECORD FOUND',
    trackLog: null, vessel_ata: null, vessel_atd: null, vessel_eta: null,
    vessel_etd: null, vessel_gate_cutoff: null,
  },
}

describe('PCS writes the ETA as ddMMyyyy with a time bolted on', () => {
  test('ddMMyyyy:HH:mm', () => {
    assert.equal(pcsEtaDate('02032023:21:18'), '2023-03-02T21:18:00.000Z')
  })
  test('Date.parse gives up on it entirely', () => {
    assert.ok(Number.isNaN(Date.parse('02032023:21:18')))
  })
  test('rejects an impossible day rather than rolling it into next month', () => {
    assert.equal(pcsEtaDate('31022023:10:00'), null)
  })
  test('rejects the other four ULIP date formats', () => {
    for (const bad of ['02032023', '02-03-2023:21:18', '22:10 20-09-2023', '29/11/2017 04:30:00 PM', '']) {
      assert.equal(pcsEtaDate(bad), null)
    }
  })
})

describe('a masked field is not a field with a value', () => {
  test('the documented goods_description is masked', () => {
    assert.equal(isMasked(PCS.goods_description), true)
  })
  test('real text is not', () => {
    assert.equal(isMasked('POLYPROPYLENE GRANULES 25KG BAGS'), false)
    assert.equal(isMasked('ASSORTED GOODS * SEE MANIFEST'), false)
    assert.equal(isMasked(null), false)
  })
})

describe('toPcs', () => {
  const m = toPcs(PCS)
  test('THE TRAP: a miss is ONE record of all nulls, under SUCCESS', () => {
    // ICEGATE returns an empty list; LDB says FAILURE; PCS returns a full
    // record with nothing in it. Neither isNotFound nor a length check
    // sees this one, and what comes out the other side looks like a real
    // manifest the gateway answered thinly for.
    assert.equal(pcsMiss(PCS_MISS), true)
    assert.equal(pcsMiss(PCS), false)
    assert.equal(pcsFound([PCS_MISS]), false)
    assert.equal(pcsFound([PCS_MISS, PCS]), true)
    assert.equal(pcsFound([]), false)
  })
  test('a miss maps to nothing, loudly', () => {
    const miss = toPcs(PCS_MISS)
    assert.deepEqual(miss.known, {})
    assert.ok(miss.missing.includes('record'))
    assert.match(miss.warnings.join(' '), /not in the port community system/)
  })
  test('carries two date formats at once, and reads both', () => {
    assert.equal(m.known.eta, '2023-03-02T21:18:00.000Z')
    assert.equal(m.known.igmDate, '2023-02-27T00:00:00.000Z')
    assert.equal(m.known.billDate, '2023-01-30T00:00:00.000Z')
  })
  test('cargo_imo_code "ZZZ" is not filed as a hazard class', () => {
    // IMDG classes are 1-9. cargo_imo_code is also NOT ICEGATE's imoCode,
    // which that document defines as the identifier of the ship.
    assert.equal(m.known.imdgClass, undefined)
    assert.match(m.warnings.join(' '), /not an IMDG class/)
  })
  test('a real IMDG class does come through', () => {
    assert.equal(toPcs({ ...PCS, cargo_imo_code: '3' }).known.imdgClass, '3')
    assert.equal(toPcs({ ...PCS, cargo_imo_code: '5.1' }).known.imdgClass, '5.1')
  })
  test('the masked description is withheld, not rendered as asterisks', () => {
    assert.equal(m.known.goodsDescription, undefined)
    assert.match(m.warnings.join(' '), /masked/)
  })
  test('string package counts become numbers', () => {
    assert.equal(m.known.packages, 55)
    assert.equal(m.known.totalPackages, 29)
  })
  test('the two weights are kept apart and flagged as unitless', () => {
    assert.equal(m.known.grossWeight, 50847)
    assert.equal(m.known.containerWeight, 25.65)
    assert.match(m.warnings.join(' '), /documents no unit/)
  })
  test('the seal number is not mistaken for the container number', () => {
    assert.equal(m.known.containerNo, 'WHSU6942383')
    assert.equal(m.known.containerSealNo, 'WHLU045961')
  })
  test('duplicate line_no/line_number pairs are read once', () => {
    assert.equal(m.known.lineNo, '40')
    assert.equal(m.known.subLineNo, '0')
  })
})

describe('LDB timestamps are only right in India', () => {
  test('timeinms is authoritative', () => {
    assert.equal(ldbEventTime(EVENT_OUT), '2023-03-29T05:30:09.000Z')
  })
  test('THE TRAP: the answer must not depend on where the process runs', () => {
    // The record carries the instant twice: timeinms, and a local
    // wall-clock string whose zone lives in a SEPARATE field. On a laptop
    // set to Asia/Kolkata, Date.parse on that string happens to agree with
    // timeinms, so the bug is invisible exactly where this was written; on
    // the UTC box that runs the delivery job and the serverless functions
    // every LDB event lands 5½ hours early — enough to move a port-out
    // across a shift and to age a signal past an SLA it has not breached.
    //
    // So this asserts the mapper never consults the runtime zone. Pinned
    // to UTC alone it would still pass with Date.parse in there, because
    // the two agree in IST — which is the shape of test that is worse than
    // no test at all.
    const tz = process.env.TZ
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
        process.env.TZ = zone
        assert.equal(ldbEventTime(EVENT_OUT), '2023-03-29T05:30:09.000Z', `under TZ=${zone}`)
        assert.equal(
          ldbEventTime({ timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'IST' }),
          '2023-03-29T05:30:09.000Z', `no-timeinms fallback under TZ=${zone}`)
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz
    }
  })
  test('without timeinms, the string is read against its own declared zone', () => {
    assert.equal(
      ldbEventTime({ timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'IST', timeinms: null }),
      '2023-03-29T05:30:09.000Z')
  })
  test('an unrecognised zone is refused, not assumed to be UTC', () => {
    assert.equal(
      ldbEventTime({ timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'SGT' }), null)
    assert.equal(
      ldbEventTime({ timestamptimezone: '2023-03-29 11:00:09' }), null)
  })
})

describe('LDB returns both trails and fills in one', () => {
  test('picks the populated one, not the first one', () => {
    assert.equal(ldbTrail(LDB)?.kind, 'exim')
  })
  test('THE TRAP: a domestic container is on the OTHER trail', () => {
    // eximContainerTrail is the populated one in the sample, which invites
    // reading it unconditionally — and then every domestic container comes
    // back empty.
    const domestic: LdbRecord = {
      eximContainerTrail: LDB.domesticContainerTrail,
      domesticContainerTrail: LDB.eximContainerTrail,
    }
    assert.equal(ldbTrail(domestic)?.kind, 'domestic')
    assert.equal(toLdb(domestic).known.events.length, 2)
  })
  test('neither trail populated is a miss, not an empty container', () => {
    const none: LdbRecord = {
      eximContainerTrail: LDB.domesticContainerTrail,
      domesticContainerTrail: LDB.domesticContainerTrail,
    }
    assert.equal(ldbTrail(none), null)
    assert.ok(toLdb(none).missing.includes('trail'))
  })
})

describe('toLdb', () => {
  const m = toLdb(LDB)
  test('container detail', () => {
    assert.equal(m.known.containerNo, 'NSST1234570')
    assert.equal(m.known.sizeFt, 40)
    assert.equal(m.known.isoCode, '22G3')
    // refflg is "Yes"/"No", not a boolean.
    assert.equal(m.known.reefer, true)
  })
  test('THE TRAP: trackLog counts up but runs newest-first', () => {
    // serialno 1 is PORT OUT on the 29th; serialno 2 is PORT IN on the
    // 28th. Sorting by serialno, or taking the last element as "latest",
    // reports the container as still inbound after it has left the port.
    assert.deepEqual(m.known.events.map((e) => e.name), ['PORT OUT', 'PORT IN'])
    assert.equal(m.known.lastEvent?.name, 'PORT OUT')
    assert.ok(Date.parse(m.known.events[0].at) > Date.parse(m.known.events[1].at))
  })
  test('ordering survives the gateway changing its mind about order', () => {
    const shuffled: LdbRecord = {
      ...LDB,
      eximContainerTrail: { ...LDB.eximContainerTrail, trackLog: [EVENT_IN, EVENT_OUT] },
    }
    assert.equal(toLdb(shuffled).known.lastEvent?.name, 'PORT OUT')
  })
  test('THE TRAP: vessel_eta carries infotime as well, a week later', () => {
    // infotime is when the notice was published, not when the vessel
    // arrives. Reading the first number on the record puts the berthing
    // eight days out.
    assert.equal(m.known.vesselEta?.at, '2023-03-28T04:33:22.000Z')
    assert.notEqual(m.known.vesselEta?.at, new Date(1680659629000).toISOString())
    assert.equal(m.known.vesselEta?.vessel, 'APR EXPRESSS')
    assert.equal(m.known.vesselEta?.terminal, 'Nhava Sheva Freeport Terminal (NSFT)')
  })
  test('an event with no placeable time is dropped and reported', () => {
    const broken: LdbRecord = {
      ...LDB,
      eximContainerTrail: {
        ...LDB.eximContainerTrail,
        trackLog: [EVENT_OUT, { ...EVENT_IN, timeinms: null, timezoneabvr: 'SGT' }],
      },
    }
    const out = toLdb(broken)
    assert.equal(out.known.events.length, 1)
    assert.match(out.warnings.join(' '), /could not be placed on a clock/)
  })
})

describe('the envelope has a third responseStatus', () => {
  test('THE TRAP: LDB reports a miss as FAILURE, not ERROR', () => {
    // One occurrence in 201 documented samples across 36 documents. An
    // equality check against 'ERROR' reads this as a hit, and an unknown
    // container then presents as one the gateway answered for.
    assert.equal(isNotFound({
      response: [{
        responseStatus: 'FAILURE',
        response: { message: { text: 'Container details not found for the given container number: TCLU8538800' } },
      }],
      error: 'false', code: '200', message: 'Success',
    }), true)
  })
  test('and a real hit is still a hit', () => {
    assert.equal(isNotFound({
      response: [{ responseStatus: 'SUCCESS', response: LDB }],
      error: 'false', code: '200', message: 'Success',
    }), false)
  })
})
