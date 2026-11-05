import { useCallback, useEffect, useState } from 'react'

const VOTER_KEY = 'croot.visitor'
let memoryVoter: string | null = null

/** A random, anonymous id for this browser, so it can heart each photo once. Nothing else is kept. */
function visitorId() {
  try {
    const existing = window.localStorage.getItem(VOTER_KEY)
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing
  } catch {
    /* storage blocked: fall back to this tab only */
  }
  if (!memoryVoter) {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    memoryVoter = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  try {
    window.localStorage.setItem(VOTER_KEY, memoryVoter)
  } catch {
    /* ignore */
  }
  return memoryVoter
}

/** "/o/:org/r/:retreat/album" → its public API base. */
function heartsApi(pageUrl: string) {
  const m = pageUrl.match(/^\/o\/([^/]+)\/r\/([^/]+)\/album$/)
  return m ? `/api/public/orgs/${m[1]}/retreats/${m[2]}/album` : null
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  // No cookies and no referrer: hearts never touch a session.
  const res = await fetch(url, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

/** Heart state for an album: counts, which ones this visitor hearted, and a toggle. */
export function useHearts(pageUrl: string, photos: Array<{ id: string; hearts: number }>) {
  const api = heartsApi(pageUrl)
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [message, setMessage] = useState<string | null>(null)
  const ids = photos.map((p) => p.id).join(',')

  useEffect(() => {
    if (!api || !ids) return
    let live = true
    postJson<{ hearted: string[] }>(`${api}/hearts/mine`, { voter: visitorId(), photoIds: ids.split(',') })
      .then((r) => live && setMine(new Set(r.hearted)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [api, ids])

  const count = (p: { id: string; hearts: number }) => counts[p.id] ?? p.hearts

  const toggle = useCallback(
    async (p: { id: string; hearts: number }) => {
      if (!api) return
      const on = !mine.has(p.id)
      const before = counts[p.id] ?? p.hearts
      // Show it at once; settle on the server's count.
      setMine((s) => {
        const n = new Set(s)
        if (on) n.add(p.id)
        else n.delete(p.id)
        return n
      })
      setCounts((c) => ({ ...c, [p.id]: Math.max(0, before + (on ? 1 : -1)) }))
      setMessage(null)
      try {
        const r = await postJson<{ hearts: number }>(`${api}/${p.id}/heart`, { voter: visitorId(), on })
        setCounts((c) => ({ ...c, [p.id]: r.hearts }))
      } catch (e) {
        setMine((s) => {
          const n = new Set(s)
          if (on) n.delete(p.id)
          else n.add(p.id)
          return n
        })
        setCounts((c) => ({ ...c, [p.id]: before }))
        setMessage((e as Error).message)
      }
    },
    [api, mine, counts],
  )

  return { enabled: Boolean(api), hearted: (id: string) => mine.has(id), count, toggle, message }
}

export function HeartButton({ on, count, onToggle, variant = 'tile' }: { on: boolean; count: number; onToggle: () => void; variant?: 'tile' | 'bar' }) {
  return (
    <button
      type="button"
      className={`heart-btn ${variant} ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={`${on ? 'Remove your heart' : 'Heart this photo'} (${count} heart${count === 1 ? '' : 's'})`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4.5 6 4.1c2.1-.2 4 .9 6 3 2-2.1 3.9-3.2 6-3 3.7.4 5.6 4.3 4 7.6C19.5 16.4 12 21 12 21z" />
      </svg>
      {count > 0 && <span>{count}</span>}
    </button>
  )
}
