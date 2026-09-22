/* GRAP eligibility.
   Every case here is a regression: the parser used to match a literal "BS",
   so a real VAHAN record — which writes "BHARAT STAGE II" — matched nothing
   and fell through to a default of 6. An unreadable norm was read as the
   CLEANEST possible vehicle and waved into Delhi at Stage IV. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ncrEligibility, cpcbAqi, grapStage } from '../src/data/osint'

describe('ncrEligibility', () => {
  test('reads the spelling VAHAN actually uses', () => {
    assert.equal(ncrEligibility(4, 'BHARAT STAGE II', 'Diesel').status, 'barred')
    assert.equal(ncrEligibility(4, 'BHARAT STAGE IV', 'Diesel').status, 'barred')
    assert.equal(ncrEligibility(4, 'BHARAT STAGE VI', 'Diesel').status, 'allowed')
  })

  test('still reads the short spelling', () => {
    assert.equal(ncrEligibility(4, 'BS-IV', 'Diesel').status, 'barred')
    assert.equal(ncrEligibility(4, 'BS-VI', 'Diesel').status, 'allowed')
  })

  test('an unreadable norm is restricted, never permitted', () => {
    // The bug: this used to default to 6 and let the vehicle through.
    const v = ncrEligibility(4, 'SOMETHING NOBODY PARSED', 'Diesel')
    assert.equal(v.status, 'barred')
    assert.match(v.reason, /could not be read/)
  })

  test('clean fuels are exempt whatever the norm', () => {
    for (const fuel of ['CNG', 'LNG', 'Electric']) {
      assert.equal(ncrEligibility(4, 'BHARAT STAGE II', fuel).status, 'allowed')
    }
  })

  test('no curbs below stage 3 — GRAP restricts entry, not delivery', () => {
    assert.equal(ncrEligibility(1, 'BHARAT STAGE II', 'Diesel').status, 'allowed')
    assert.equal(ncrEligibility(2, 'BHARAT STAGE II', 'Diesel').status, 'allowed')
  })

  test('essential carriage is exempt where the rules say so', () => {
    assert.equal(ncrEligibility(4, 'BS-IV', 'Diesel', true).status, 'essential_only')
  })
})

describe('CPCB AQI', () => {
  test('the worse pollutant governs the index', () => {
    assert.ok(cpcbAqi(300, 10) > cpcbAqi(10, 10))
    assert.ok(cpcbAqi(10, 300) > cpcbAqi(10, 10))
  })
  test('stage rises with the index and never falls', () => {
    const stages = [50, 150, 250, 350, 450].map(grapStage)
    for (let i = 1; i < stages.length; i++) assert.ok(stages[i] >= stages[i - 1])
  })
})
