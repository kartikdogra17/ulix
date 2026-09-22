/* Corridors. Two regressions here, both found by checking a distribution
   rather than reading the code: rail was being judged against a road
   standard so every freight corridor came back constrained, and a corridor
   that was six-lane end to end reported every segment as a pinch. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { makeGatiShakti, constrained } from '../src/data/gatishakti'

const layer = makeGatiShakti()

describe('makeGatiShakti', () => {
  test('is deterministic — the demo is the same world every reload', () => {
    assert.deepEqual(makeGatiShakti().corridors, layer.corridors)
  })

  test('does not flag every corridor', () => {
    const bad = constrained(layer.corridors)
    assert.ok(bad.length > 0, 'a layer that never finds a constraint is wallpaper')
    assert.ok(bad.length < layer.corridors.length, 'a layer that flags everything trains people to ignore it')
  })

  test('a corridor above standard reports no pinches at all', () => {
    for (const c of layer.corridors) {
      if (!c.belowStandard) assert.equal(c.pinchPoints, 0)
      else assert.ok(c.pinchPoints > 0)
    }
  })

  test('rail is never judged against a road standard', () => {
    // 2L on road is sub-standard; 2T on rail is not. Comparing across modes
    // made every freight corridor "below four lanes" — it has no lanes.
    for (const c of layer.corridors) {
      const grades = new Set(c.segments.map((s) => s.lanes))
      if (c.mode === 'rail') {
        for (const g of grades) assert.match(g, /T$/, 'rail segments are tracks')
        if (c.belowStandard) assert.equal(c.narrowest, '1T')
      } else {
        for (const g of grades) assert.match(g, /L$/, 'road segments are lanes')
        if (c.belowStandard) assert.equal(c.narrowest, '2L')
      }
    }
  })

  test('narrowest really is the narrowest segment', () => {
    const rank: Record<string, number> = { '1T': 0, '2L': 1, '2T': 2, '4L': 3, '6L': 4 }
    for (const c of layer.corridors) {
      const worst = Math.min(...c.segments.map((s) => rank[s.lanes]))
      assert.equal(rank[c.narrowest], worst)
    }
  })

  test('depots carry no coordinates, because the endpoint returns none', () => {
    for (const d of layer.depots) {
      assert.equal('lat' in d, false, 'inventing a coordinate is the same sin as faking data')
    }
  })

  test('parks can be full — land availability is not always positive', () => {
    assert.ok(layer.parks.some((p) => p.landAvailableHa === 0))
    assert.ok(layer.parks.some((p) => p.landAvailableHa > 0))
  })
})
