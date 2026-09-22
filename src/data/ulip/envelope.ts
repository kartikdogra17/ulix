/* ────────────────────────────────────────────────────────────────
   The ULIP response envelope, as documented identically across
   every dataset endpoint (see docs/ulip-api/).

   Success:
   {
     "response": [ { "response": { … }, "responseStatus": "SUCCESS" } ],
     "error": "false", "code": "200", "message": "Success"
   }

   Validation failure:
   {
     "response": null, "error": "true", "code": "400",
     "message": "Data format failed OR wrong value entered at: ewbNo.
                 Format should follow [0-9]{12}"
   }

   Note the two traps this shape sets:
   1. `error` and `code` are STRINGS, not a boolean and a number.
   2. A record that does not exist still returns HTTP 200 with
      `error: "false"` — the failure is reported on the INNER
      `responseStatus`/`errorCodes`. Checking only the outer code
      will silently treat "not found" as success.
   ──────────────────────────────────────────────────────────────── */

export interface UlipRecord<T = unknown> {
  response: T
  /**
   * `ERROR` is what 31 of the documented samples use for a miss. LDB/01
   * uses `FAILURE` — once, in 201 samples across all 36 documents, and
   * nowhere else. A union of the two obvious values compiles fine and
   * then reads a real LDB miss as neither a hit nor a miss.
   */
  responseStatus: 'SUCCESS' | 'ERROR' | 'FAILURE'
}

export interface UlipEnvelope<T = unknown> {
  response: Array<UlipRecord<T>> | null
  error: 'true' | 'false'
  code: string
  message: string
}

export class UlipError extends Error {
  readonly code: number
  readonly endpoint?: string
  readonly raw?: unknown

  constructor(code: number, message: string, endpoint?: string, raw?: unknown) {
    super(message)
    this.name = 'UlipError'
    this.code = code
    this.endpoint = endpoint
    this.raw = raw
  }
}

/**
 * Unwrap an envelope into plain records, applying both checks above.
 * Returns only the records the source system actually resolved.
 */
export function unwrap<T>(env: UlipEnvelope<T>, endpoint?: string): T[] {
  if (env.error === 'true' || env.code !== '200') {
    throw new UlipError(Number(env.code) || 500, env.message || 'ULIP request failed', endpoint, env)
  }
  const records = env.response ?? []
  return records.filter((r) => r.responseStatus === 'SUCCESS').map((r) => r.response)
}

/**
 * True when ULIP answered but the source system had no matching record.
 *
 * Tested for the ABSENCE of SUCCESS rather than the presence of ERROR:
 * LDB/01 says `FAILURE`, and an equality check against `ERROR` reports
 * that miss as a hit — an unknown container then reads as a container the
 * gateway answered for with nothing to say.
 */
export function isNotFound<T>(env: UlipEnvelope<T>): boolean {
  if (env.error === 'true') return false
  const records = env.response ?? []
  return records.length > 0 && records.every((r) => r.responseStatus !== 'SUCCESS')
}

/** Build the same envelope locally so mock and live paths are indistinguishable. */
export function envelope<T>(records: T[]): UlipEnvelope<T> {
  return {
    response: records.map((response) => ({ response, responseStatus: 'SUCCESS' as const })),
    error: 'false',
    code: '200',
    message: 'Success',
  }
}

export function errorEnvelope(code: number, message: string): UlipEnvelope<never> {
  return { response: null, error: 'true', code: String(code), message }
}

/** The documented "record absent at source" shape — HTTP 200, inner ERROR. */
export function notFoundEnvelope(errorCode = '404'): UlipEnvelope<{ errorCodes: string }> {
  return {
    response: [{ response: { errorCodes: errorCode }, responseStatus: 'ERROR' }],
    error: 'false',
    code: '200',
    message: 'Success',
  }
}
