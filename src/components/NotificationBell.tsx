import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { get } from '../lib/api'

export interface AttentionItem {
  id: string
  scope: string
  title: string
  detail?: string
  href: string
  urgent?: boolean
  at?: string
}

/**
 * The bell in the top bar for organisers and admins: things waiting on them (guest messages, stories
 * to publish, photos to approve, new anonymous notes, admin requests). Items clear themselves once
 * dealt with; the list refreshes every minute, on returning to the tab, and after each page change.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const location = useLocation()
  const q = useQuery({
    queryKey: ['attention'],
    queryFn: () => get<{ items: AttentionItem[] }>('/api/attention'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })
  const items = q.data?.items ?? []
  const count = items.length
  const urgent = items.some((i) => i.urgent)

  // Fresh after every page change (the thing just handled drops off), and the panel closes.
  const refetch = q.refetch
  useEffect(() => {
    setOpen(false)
    void refetch()
  }, [location.pathname, location.search, refetch])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = items.reduce<Array<[string, AttentionItem[]]>>((acc, item) => {
    const g = acc.find(([s]) => s === item.scope)
    if (g) g[1].push(item)
    else acc.push([item.scope, [item]])
    return acc
  }, [])

  return (
    <div className="bell" ref={wrap}>
      <button
        type="button"
        className={`bell-button ${count ? 'has-items' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={count ? `Notifications: ${count} need${count === 1 ? 's' : ''} attention` : 'Notifications: nothing needs attention'}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && <span className={`bell-count ${urgent ? 'urgent' : ''}`}>{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="bell-panel" id={panelId} role="region" aria-label="Needs your attention">
          <div className="bell-panel-head">
            <strong>Needs your attention</strong>
          </div>
          {q.isError && <p className="small muted bell-empty">Couldn’t load notifications. They’ll retry in a minute.</p>}
          {!q.isError && count === 0 && <p className="small muted bell-empty">You’re all caught up.</p>}
          {groups.map(([scope, list]) => (
            <div key={scope} className="bell-group">
              {groups.length > 1 && <p className="bell-scope">{scope}</p>}
              <ul>
                {list.map((item) => (
                  <li key={item.id}>
                    <Link to={item.href} className={`bell-item ${item.urgent ? 'urgent' : ''}`} onClick={() => setOpen(false)}>
                      <span className="bell-item-title">{item.title}</span>
                      {item.detail && <span className="bell-item-detail">{item.detail}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
