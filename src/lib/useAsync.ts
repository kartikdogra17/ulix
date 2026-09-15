import { useCallback, useEffect, useRef, useState } from 'react'

/** Small async-state hook: keeps the previous value visible while refetching. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const gen = useRef(0)

  const run = useCallback(() => {
    const mine = ++gen.current
    setLoading(true)
    fn().then(
      (v) => { if (mine === gen.current) { setData(v); setError(null); setLoading(false) } },
      (e) => { if (mine === gen.current) { setError(e as Error); setLoading(false) } },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { run() }, [run])
  return { data, loading, error, refresh: run }
}

/** Debounce a rapidly-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 280) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
