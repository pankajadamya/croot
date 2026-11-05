import { useCallback, useEffect, useState } from 'react'
import { postJson, visitorId } from './Hearts'

/**
 * "Found this review helpful" for a set of published stories. Same one-per-browser visitor id as
 * hearts; the server keeps only a hash of it. Tapping again takes the vote back.
 */
export function useHelpful(stories: Array<{ slug: string; helpful: number }>) {
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [message, setMessage] = useState<string | null>(null)
  const slugs = stories.map((s) => s.slug).join(',')

  useEffect(() => {
    if (!slugs) return
    let live = true
    postJson<{ helpful: string[] }>('/api/public/stories/helpful/mine', { voter: visitorId(), slugs: slugs.split(',') })
      .then((r) => live && setMine(new Set(r.helpful)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [slugs])

  const count = (s: { slug: string; helpful: number }) => counts[s.slug] ?? s.helpful

  const toggle = useCallback(
    async (s: { slug: string; helpful: number }) => {
      const on = !mine.has(s.slug)
      const before = counts[s.slug] ?? s.helpful
      const flip = (add: boolean) =>
        setMine((m) => {
          const n = new Set(m)
          if (add) n.add(s.slug)
          else n.delete(s.slug)
          return n
        })
      flip(on)
      setCounts((c) => ({ ...c, [s.slug]: Math.max(0, before + (on ? 1 : -1)) }))
      setMessage(null)
      try {
        const r = await postJson<{ helpful: number }>(`/api/public/stories/${s.slug}/helpful`, { voter: visitorId(), on })
        setCounts((c) => ({ ...c, [s.slug]: r.helpful }))
      } catch (e) {
        flip(!on)
        setCounts((c) => ({ ...c, [s.slug]: before }))
        setMessage((e as Error).message)
      }
    },
    [mine, counts],
  )

  return { voted: (slug: string) => mine.has(slug), count, toggle, message }
}

export function HelpfulButton({ on, count, onToggle }: { on: boolean; count: number; onToggle: () => void }) {
  return (
    <button type="button" className={`helpful-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={onToggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7zm0 0 4-6.5c.6-1 2.1-.9 2.6.2.2.5.2 1 .1 1.5L13 9h5.6c1.4 0 2.4 1.3 2 2.7l-1.9 6.6A2.4 2.4 0 0 1 16.4 20H7" />
      </svg>
      <span>{on ? 'You found this helpful' : 'Helpful'}</span>
      {count > 0 && <span className="helpful-count">{count}</span>}
    </button>
  )
}
