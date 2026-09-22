/* Conformance check against the documented response samples.
 *
 * Run:  npx tsx scripts/conformance.ts
 *
 * The point is to find out where the domain model and the real gateway
 * disagree BEFORE credentials arrive, using the verbatim samples in
 * docs/ulip-api/. Every value below is copied from an integration
 * document, not invented — including the masking, the empty strings and
 * the "BHARAT STAGE II" spelling that broke the GRAP check.
 */
import {
  boeFound, ldbTrail, pcsFound, pcsMiss, toBoe, toEwayBill, toLdb, toPcs, toRake, toVehicle,
  FIELD_GAPS,
  type BoeRecord, type EwayBillRecord, type FastagRecord, type FoisRecord,
  type LdbRecord, type PcsRecord, type VahanRecord,
} from '../src/data/ulip/map'
import { isNotFound } from '../src/data/ulip/envelope'
import { ncrEligibility } from '../src/data/osint'

/** VAHAN/01, from ULIP_VAHAN_Integration_Requirement. */
const VAHAN: VahanRecord = {
  rcRegnNo: 'UP91L0001',
  rcRegnDt: '26-Jan-2017',
  rcChasiNo: 'ME4JF509AH70*****',
  rcEngNo: 'JF50E760*****',
  rcVhClassDesc: 'M-Cycle/Scooter',
  rcMakerModel: 'HONDA ACTIVA',
  rcOwnerName: 'R***L K***R',
  rcFuelDesc: 'PETROL',
  rcNormsDesc: 'BHARAT STAGE II',
  rcStatus: 'ACTIVE',
  rcBlacklistStatus: '',
  rcFitUpto: '25-Jan-2032',
  rcInsuranceUpto: '15-Sep-2020',
  rcPuccUpto: '',
  rcRegnUpto: '25-Jan-2032',
  rcGvw: '269',
} as VahanRecord

/** FASTAG/01, from ULIP_FASTAG_Integration_Requirement. */
const FASTAG: FastagRecord[] = [{
  readerReadTime: '2021-10-30 12:26:09.0',
  seqNo: '68d47e2d-c10f-4f57-b12a-2dfb547ce5c8',
  laneDirection: 'N',
  tollPlazaGeocode: '11.0001,11.0001',
  tollPlazaName: 'GMR Chillakallu Toll Plaza',
  vehicleType: 'VC7',
  vehicleRegNo: 'MH19JK3923',
}]

let failures = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name.padEnd(42)} ${ok ? '' : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

console.log('\nVAHAN/01 → Vehicle')
const { known, missing } = toVehicle('UP91L0001', VAHAN, FASTAG)
check('regNo', known.regNo, 'UP91L0001')
check('bsNorm reads BHARAT STAGE II', known.bsNorm, 'BS-II')
check('fuel reads PETROL', known.fuel, 'Petrol')
check('rcStatus', known.rcStatus, 'ACTIVE')
check('fitnessUpto parsed from dd-MMM-yyyy', known.fitnessUpto?.slice(0, 10), '2032-01-25')
check('insuranceUpto parsed', known.insuranceUpto?.slice(0, 10), '2020-09-15')
check('capacityKg from rcGvw string', known.capacityKg, 269)
check('empty rcPuccUpto is missing, not faked', missing.includes('pucUpto'), true)
check('empty rcBlacklistStatus is missing', missing.includes('tagStatus'), true)

console.log('\nFASTAG/01 → crossings')
check('one crossing mapped', known.crossings?.length, 1)
check('plaza name', known.crossings?.[0].plaza, 'GMR Chillakallu Toll Plaza')
check('geocode split', [known.crossings?.[0].lat, known.crossings?.[0].lon], [11.0001, 11.0001])
check('amount not invented', known.crossings?.[0].amount, 0)

console.log('\nGRAP against the real norm spelling')
const raw = ncrEligibility(4, 'BHARAT STAGE II', 'Diesel')
check('BS-II diesel barred at Stage IV', raw.status, 'barred')
const unreadable = ncrEligibility(4, 'SOMETHING ELSE', 'Diesel')
check('unreadable norm fails safe (not allowed)', unreadable.status, 'barred')

/** EWAYBILL/01, from ULIP_EWAYBILL_Integration_Requirement. */
const EWB: EwayBillRecord = {
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

console.log('\nEWAYBILL/01 → e-Way Bill')
const ewb = toEwayBill(EWB)
check('ewbNo survives being a number in the response', ewb.known.ewbNo, '101000609218')
check('dd/MM/yyyy is not read as MM/dd', ewb.known.issuedAt?.slice(0, 10), '2017-11-29')
check('status ACT decoded', ewb.known.status, 'active')
check('Part-B vehicle read', ewb.known.partB[0]?.vehicleNo, 'RJ14CG4508')
check('transMode 1 is road', ewb.known.partB[0]?.mode, 'road')
check('validUpto has NO date in the sample', ewb.known.validUpto, undefined)
check('  and says so rather than guessing', /cannot be compared against an ETA/.test(ewb.warnings[0] ?? ''), true)

console.log('\nFOIS/01 → rake')
const rake = toRake({
  newFnr: '', etaDstn: '22:10 20-09-2023', cmdt: 'PHC', lastRepStts: 'AR',
  lastRepLocn: 'M/S NABHA POWER LTD.SIDING(NPSB)', lgtd: '76.515312',
  fnrNo: '23091420258', lttd: '30.538016',
  stationFrom: 'NEW KUSMUNDA COLLIERY SIDING,  KORBA(NKCR)',
  stationTo: 'M/S NABHA POWER LTD.SIDING(NPSB)',
} as FoisRecord)
check('time-first date parsed', rake.known.eta?.slice(0, 10), '2023-09-20')
check('lat/lon not swapped', [rake.known.position?.lat, rake.known.position?.lon], [30.538016, 76.515312])
check('station code extracted', rake.known.from?.code, 'NKCR')
check('status abbreviation decoded', rake.known.statusLabel, 'Arrived')

console.log('\nICEGATE/02 → bill of entry')
const boe = toBoe({
  imoCode: '1000000', containerNo: ['MSCU7786602'], unitOfQt: 'MTS',
  igmDt: '04072011', natureOfCargo: 'C', countryOrig: 'BR', grossWt: 25.99, totNoPkg: 56,
} as BoeRecord)
check('separator-free date parsed', boe.known.igmDate?.slice(0, 10), '2011-07-04')
check('containers are a list', boe.known.containers, ['MSCU7786602'])
check('cargo nature decoded', boe.known.natureLabel, 'Containerised')
check('empty boeDetails is a MISS, despite SUCCESS', boeFound([]), false)

/** PCS/01 hit, from ULIP_PCS_Integration_Requirement. */
const PCS_HIT: PcsRecord = {
  voyage_no: '909E', bill_date: '30012023', port_of_arrival: 'INMUN1',
  goods_description: 'P*A*T*C*R*G*I*D*H* *O*E*3*0*1*9* *5*(*I*T* *I*E* *A*K*G*S*O*L* *E* * *A*F*7*2*L*5* *A*K*G*S',
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

/** PCS/01 MISS — every documented field, all null, under SUCCESS. */
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

console.log('\nPCS/01 → manifest')
const pcs = toPcs(PCS_HIT)
check('ddMMyyyy:HH:mm ETA parsed', pcs.known.eta, '2023-03-02T21:18:00.000Z')
check('bare ddMMyyyy igm_date parsed', pcs.known.igmDate?.slice(0, 10), '2023-02-27')
check('cargo nature decoded', pcs.known.natureLabel, 'Containerised')
check('cargo_imo_code ZZZ is NOT a hazard class', pcs.known.imdgClass, undefined)
check('  and says so', /not an IMDG class/.test(pcs.warnings.join(' ')), true)
check('masked description is not shown', pcs.known.goodsDescription, undefined)
check('duplicate line_no/line_number read once', pcs.known.lineNo, '40')
check('string package counts become numbers', [pcs.known.packages, pcs.known.totalPackages], [55, 29])
check('THE TRAP: a miss is a null record under SUCCESS', pcsMiss(PCS_MISS), true)
check('  a hit is not', pcsMiss(PCS_HIT), false)
check('  and a length check cannot tell them apart', pcsFound([PCS_MISS]), false)

/** LDB/01, from ULIP_LDB_Integration_Requirement. */
const LDB: LdbRecord = {
  eximContainerTrail: {
    cntrDetail: { cntrno: 'NSST1234570', refflg: 'Yes', cntrsize: 40, isocode: '22G3', containertype: null },
    dpd_dpe: { c_import: { dpd: 'N', destination: null }, c_export: null },
    last_event: [{
      serialno: 1, eventname: 'PORT OUT',
      currentlocation: 'Raigad/Nhava Sheva Freeport Terminal (NSFT)', division: null,
      timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'IST',
      latitude: 18.950149, longitude: 72.95123, containernumber: 'NSST1234570',
      timeinms: 1680067809000, transportmode: 'TRUCK', type: 'I', isempty: 'Y',
    }],
    res_Message: 'Success',
    trackLog: [
      {
        serialno: 1, eventname: 'PORT OUT',
        currentlocation: 'Raigad/Nhava Sheva Freeport Terminal (NSFT)', division: null,
        timestamptimezone: '2023-03-29 11:00:09', timezoneabvr: 'IST',
        latitude: 18.950149, longitude: 72.95123, containernumber: 'NSST1234570',
        timeinms: 1680067809000, transportmode: 'TRUCK', type: 'I', isempty: 'Y',
      },
      {
        serialno: 2, eventname: 'PORT IN',
        currentlocation: 'Raigad/Nhava Sheva Freeport Terminal (NSFT)', division: null,
        timestamptimezone: '2023-03-28 09:00:08', timezoneabvr: 'IST',
        latitude: 18.950149, longitude: 72.95123, containernumber: 'NSST1234570',
        timeinms: 1679974208000, transportmode: 'VESSEL', type: 'I', isempty: 'Y',
      },
    ],
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

console.log('\nLDB/01 → container')
check('picks the populated trail, not the first one', ldbTrail(LDB)?.kind, 'exim')
const ldb = toLdb(LDB)
check('container number', ldb.known.containerNo, 'NSST1234570')
check('refflg "Yes" is a reefer', ldb.known.reefer, true)
check('two events', ldb.known.events.length, 2)
check('newest first despite serialno ascending', ldb.known.lastEvent?.name, 'PORT OUT')
check('event time from timeinms, not the local string', ldb.known.events[0].at, '2023-03-29T05:30:09.000Z')
check('  which is NOT what Date.parse gives on a UTC box',
  ldb.known.events[0].at === '2023-03-29T11:00:09.000Z', false)
check('vessel ETA from timeinms, not infotime', ldb.known.vesselEta?.at, '2023-03-28T04:33:22.000Z')
check('  infotime is a week later and is not the ETA',
  ldb.known.vesselEta?.at !== new Date(1680659629000).toISOString(), true)
check('vessel name', ldb.known.vesselEta?.vessel, 'APR EXPRESSS')

console.log('\nThe envelope has a third responseStatus')
check('LDB reports a miss as FAILURE, and isNotFound must catch it',
  isNotFound({
    response: [{
      responseStatus: 'FAILURE',
      response: { message: { text: 'Container details not found for the given container number: TCLU8538800' } },
    }],
    error: 'false', code: '200', message: 'Success',
  }), true)

console.log('\nDeclared gaps — fields no ULIP endpoint carries')
for (const k of Object.keys(FIELD_GAPS)) console.log(`  • ${k}`)

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
