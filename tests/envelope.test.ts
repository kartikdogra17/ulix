/* The ULIP envelope. It reports a missing record as HTTP 200 with
   error: "false", and puts the actual failure on the INNER responseStatus.
   `error` and `code` are strings, not a boolean and a number. */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { unwrap, isNotFound, envelope, notFoundEnvelope, errorEnvelope } from '../src/data/ulip/envelope'

describe('the envelope lies, and unwrap knows it', () => {
  test('a not-found is a 200 that must not read as success', () => {
    const env = notFoundEnvelope()
    assert.equal(env.error, 'false', 'the gateway really does say false here')
    assert.equal(isNotFound(env), true)
  })

  test('a real payload unwraps to its records', () => {
    const env = envelope([{ a: 1 }, { a: 2 }])
    assert.equal(isNotFound(env), false)
    assert.equal(unwrap(env).length, 2)
  })

  test('error and code are strings, never a boolean and a number', () => {
    const env = errorEnvelope(400, 'bad')
    assert.equal(typeof env.error, 'string')
    assert.equal(typeof env.code, 'string')
  })
})
