import { useEffect, useRef } from 'react'
import { matchPath, useLocation } from 'react-router'

/**
 * Cookieless page statistics, sent to our self-hosted Umami (server/src/lib/analytics.ts adds its
 * script only when configured; without it everything here does nothing).
 *
 * Umami's automatic tracking is off because addresses here can carry secrets: invite, receipt,
 * album, interest and setup links are tokens, and admin addresses hold ids. Each page view is
 * reported as the route pattern instead (`/admin/:orgSlug/team`). The only real values kept are
 * the slugs of public, indexable pages (an organiser's page, a retreat page, a story), so
 * organisers can see which retreats are read.
 *
 * Guests' invitation, receipt and album pages are counted the same way, by kind only, so organisers
 * can see how many guests open an invitation and how many finish. My reviews (signed in, personal)
 * is not counted.
 *
 * Where a visitor came from: the referring site's origin, which email and messaging apps rarely
 * send, so the links Croot hands out carry ?via= (email invitations, copied links, the share kit's
 * caption). Only a value from the fixed list below is reported, as Umami's utm_source.
 */
const NOT_COUNTED = new Set(['/my-reviews/:attendeeId/album', '/my-reviews/:attendeeId', '/my-reviews'])
export const VIA = ['email', 'link', 'social', 'whatsapp', 'instagram', 'facebook', 'qr'] as const

/** The ?via= value when it is one of ours; anything else is ignored. */
export function viaFrom(search: string): string | null {
  const via = new URLSearchParams(search).get('via')?.toLowerCase() ?? ''
  return (VIA as readonly string[]).includes(via) ? via : null
}
const PUBLIC_PAGES = ['/o/:orgSlug/r/:retreatSlug', '/o/:orgSlug', '/stories/:slug', '/o/:orgSlug/privacy', '/legal/:doc']

/** Every route in App.tsx, most specific first. Others are reported as /other. */
export const SCREENS = [
  '/',
  '/o/:orgSlug/r/:retreatSlug',
  '/o/:orgSlug/privacy',
  '/o/:orgSlug',
  '/stories/:slug',
  '/legal/:doc',
  '/album/:token',
  '/interest/:token/unsubscribe',
  '/interest/:token',
  '/invite/:token/album',
  '/invite/:token',
  '/response/:token/album',
  '/response/:token',
  '/signin',
  '/admin/login',
  '/my-reviews/:attendeeId/album',
  '/my-reviews/:attendeeId',
  '/my-reviews',
  '/organiser/request',
  '/organiser/invite/:token',
  '/admin/setup/:token',
  '/admin/:orgSlug/retreats/new',
  '/admin/:orgSlug/retreats/:retreatId/:tab',
  '/admin/:orgSlug/retreats/:retreatId',
  '/admin/:orgSlug/responses/:responseId',
  '/admin/:orgSlug/team',
  '/admin/:orgSlug/audit',
  '/admin/:orgSlug/interest',
  '/admin/:orgSlug/privacy',
  '/admin/:orgSlug',
  '/admin',
  '/platform',
]

/** What is reported for an address, never a token or an id; null when the page is not counted. */
export function screenFor(pathname: string): string | null {
  for (const pattern of SCREENS) {
    const match = matchPath(pattern, pathname)
    if (!match) continue
    if (NOT_COUNTED.has(pattern)) return null
    if (PUBLIC_PAGES.includes(pattern)) return match.pathname
    // A retreat's tab name is a fixed word, not an id; worth keeping.
    if (pattern === '/admin/:orgSlug/retreats/:retreatId/:tab') {
      const tab = /^[a-z-]{1,24}$/.test(match.params.tab ?? '') ? match.params.tab : ':tab'
      return `/admin/:orgSlug/retreats/:retreatId/${tab}`
    }
    return pattern
  }
  return '/other'
}

/** Where a visitor came from, as an origin only, and nothing when it was Croot itself. */
export function referrerOrigin(referrer: string, ownOrigin: string): string {
  try {
    const origin = new URL(referrer).origin
    return origin === ownOrigin || origin === 'null' ? '' : `${origin}/`
  } catch {
    return ''
  }
}

type UmamiProps = Record<string, unknown>
declare global {
  interface Window {
    umami?: { track: (props: (defaults: UmamiProps) => UmamiProps) => unknown }
  }
}

function umamiScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>('script[data-website-id]')
}

/** Reports a page view on every change of page. Mounted once, in App. */
export function usePageAnalytics() {
  const { pathname, search } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    const script = umamiScript()
    if (!script) return
    const screen = screenFor(pathname)
    if (screen === null) return
    const referrer = first.current ? referrerOrigin(document.referrer, window.location.origin) : ''
    const via = first.current ? viaFrom(search) : null
    first.current = false
    const url = via ? `${screen}?utm_source=${via}` : screen
    const send = () => window.umami?.track((defaults) => ({ ...defaults, url, title: screen, referrer }))
    if (window.umami) {
      send()
      return
    }
    script.addEventListener('load', send, { once: true })
    return () => script.removeEventListener('load', send)
    // One view per page: a change of query string alone (a filter, a tab) is not a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
