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
import { toEwayBill, toVehicle, FIELD_GAPS, type EwayBillRecord, type FastagRecord, type VahanRecord } from '../src/data/ulip/map'
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

console.log('\nDeclared gaps — fields no ULIP endpoint carries')
for (const k of Object.keys(FIELD_GAPS)) console.log(`  • ${k}`)

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
