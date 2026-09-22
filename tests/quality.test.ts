/* Detector precision. Regression: MIN_SAMPLE started at 8, where the
   standard error is about 17 points — a detector built to be right 45% of
   the time displayed 74% and outranked genuinely good checks. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeCaseOutcomes, detectorQuality, MIN_SAMPLE, weakDetectors } from '../src/data/quality'

const rows = detectorQuality(makeCaseOutcomes(), [])

describe('detectorQuality', () => {
  test('measured precision tracks how each check actually works', () => {
    const by = new Map(rows.map((r) => [r.kind, r.precision]))
    // Looked up in a government register: nearly always right.
    assert.ok((by.get('customs_hold') ?? 0) > 0.8)
    assert.ok((by.get('insurance_lapsed') ?? 0) > 0.8)
    // Inferred from absence or from open news: weak, and should look weak.
    assert.ok((by.get('vehicle_dark') ?? 1) < 0.65)
    assert.ok((by.get('corridor_disruption') ?? 1) < 0.6)
  })

  test('a thin sample reports nothing rather than inventing confidence', () => {
    for (const r of rows) {
      const judged = r.actioned + r.falsePositive
      if (judged < MIN_SAMPLE) assert.equal(r.precision, null)
      else assert.ok(r.precision !== null)
    }
  })

  test('both states occur, so neither branch of the UI is dead', () => {
    assert.ok(rows.some((r) => r.precision === null), 'nothing abstains')
    assert.ok(rows.some((r) => r.precision !== null), 'nothing is scored')
  })

  test('no_longer_relevant is excluded from precision', () => {
    // A consignment delivered before anyone opened the case says nothing
    // about whether the check was right.
    for (const r of rows) {
      assert.equal(r.closed, r.actioned + r.falsePositive + r.lapsed)
      if (r.precision !== null) {
        assert.equal(r.precision, r.actioned / (r.actioned + r.falsePositive))
      }
    }
  })

  test('weak detectors are a minority, or the panel says nothing', () => {
    const weak = weakDetectors(rows)
    const scored = rows.filter((r) => r.precision !== null)
    assert.ok(weak.length > 0)
    assert.ok(weak.length < scored.length / 2)
  })

  test('worst first — the thing to distrust leads', () => {
    const scored = rows.filter((r) => r.precision !== null).map((r) => r.precision!)
    for (let i = 1; i < scored.length; i++) assert.ok(scored[i] >= scored[i - 1])
  })
})
