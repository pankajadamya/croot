import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * A choice kept in the page address (?key=value), so a refresh, or a link someone shares, opens
 * the same tab, section or filter. Only the allowed values are read; the default leaves the address
 * clean. Changes replace the history entry, so Back still leaves the page rather than stepping
 * through every tab clicked.
 */
export function useUrlState<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  const set = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next === fallback) out.delete(key)
          else out.set(key, next)
          return out
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [key, fallback, setParams],
  )
  return [value, set]
}
