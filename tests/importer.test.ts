/* CSV → the consignment book. Rows are validated with the same call path
   the real gateway request uses, so a row marked ready here cannot be
   refused at the counter for its format. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, importConsignments } from '../src/data/importer'

describe('parseCsv', () => {
  test('survives what finance systems actually export', () => {
    assert.deepEqual(parseCsv('a,"b,c",d')[0], ['a', 'b,c', 'd'])
    assert.deepEqual(parseCsv('a,"he said ""hi""",c')[0], ['a', 'he said "hi"', 'c'])
    assert.deepEqual(parseCsv('a,"line1\nline2",c')[0], ['a', 'line1\nline2', 'c'])
    assert.equal(parseCsv('a,b\r\nc,d').length, 2)
    assert.equal(parseCsv('﻿ref,eway')[0][0], 'ref', 'Excel writes a BOM')
    assert.equal(parseCsv('a,b\n\n\nc,d').length, 2)
  })
})

describe('importConsignments', () => {
  const csv = [
    'Docket No,E-Way Bill No,Vehicle Reg,From,To,Goods,Gross Weight,Invoice Value,Remarks',
    'DKT-1,101000609218,MH19JK3923,Pune,Nagpur,"Steel coils, hot rolled",18500,"₹12,45,000",x',
    'DKT-2,12345,GA060000,Delhi,Jaipur,Textiles,9000,340000,',
    'DKT-3,,KA51AB1234,Chennai,Kochi,Tea,4200,180000,',
    'DKT-4,,,Surat,Mumbai,Fabric,1200,90000,',
  ].join('\n')
  const r = importConsignments(csv)

  test('maps headers nobody writes as "ref"', () => {
    const fields = r.mapped.map((m) => m.field)
    for (const f of ['ref', 'ewayBill', 'vehicleNo', 'origin', 'destination']) {
      assert.ok(fields.includes(f as never), `${f} not mapped`)
    }
  })
  test('carries unrecognised columns through rather than dropping them', () => {
    assert.deepEqual(r.unmapped, ['Remarks'])
  })
  test('reads Indian money formatting', () => {
    assert.equal(r.rows[0].invoiceValue, 1245000)
  })
  test('keeps a quoted comma inside its field', () => {
    assert.equal(r.rows[0].commodity, 'Steel coils, hot rolled')
  })
  test('a valid bill and plate resolve against three endpoints', () => {
    assert.deepEqual(r.rows[0].resolvable, ['EWAYBILL/01', 'VAHAN/01', 'FASTAG/01'])
  })
  test('a malformed bill is rejected with the gateway wording', () => {
    assert.match(r.rows[1].problems[0].message, /Format should follow \[0-9\]\{12\}/)
  })
  test('a partial key still gives partial enrichment', () => {
    assert.deepEqual(r.rows[1].resolvable, ['VAHAN/01', 'FASTAG/01'])
    assert.deepEqual(r.rows[2].resolvable, ['VAHAN/01', 'FASTAG/01'])
  })
  test('a row with no identifier is blocked, and says so', () => {
    assert.deepEqual(r.rows[3].resolvable, [])
    assert.equal(r.blocked, 1)
  })
  test('line numbers point back at the file', () => {
    assert.equal(r.rows[3].line, 5)
  })
  test('a file with no usable key fails fast and names the columns', () => {
    const bad = importConsignments('Name,City\nfoo,bar')
    assert.match(bad.fatal ?? '', /No e-Way Bill or vehicle number/)
    assert.match(bad.fatal ?? '', /Name, City/)
  })
})
