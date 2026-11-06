import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { referrerOrigin, SCREENS, screenFor, viaFrom } from './analytics'

describe('page statistics: what is reported', () => {
  it('covers every route in App.tsx', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*')
    expect(routes.length).toBeGreaterThan(20)
    for (const route of routes) expect(SCREENS, route).toContain(route)
  })

  it('never reports a token or an id', () => {
    expect(screenFor('/admin/setup/s3cr3t-token')).toBe('/admin/setup/:token')
    expect(screenFor('/organiser/invite/abc123')).toBe('/organiser/invite/:token')
    expect(screenFor('/admin/balance-beyond/responses/r-42')).toBe('/admin/:orgSlug/responses/:responseId')
    expect(screenFor('/admin/balance-beyond/retreats/abc/site')).toBe('/admin/:orgSlug/retreats/:retreatId/site')
    expect(screenFor('/admin/balance-beyond/retreats/abc/Some%20Thing')).toBe('/admin/:orgSlug/retreats/:retreatId/:tab')
    expect(screenFor('/somewhere/else?x=1')).toBe('/other')
  })

  it('counts guests’ link pages by kind only, and not My reviews', () => {
    expect(screenFor('/invite/s3cr3t')).toBe('/invite/:token')
    expect(screenFor('/invite/s3cr3t/album')).toBe('/invite/:token/album')
    expect(screenFor('/response/s3cr3t')).toBe('/response/:token')
    expect(screenFor('/album/s3cr3t')).toBe('/album/:token')
    expect(screenFor('/interest/s3cr3t/unsubscribe')).toBe('/interest/:token/unsubscribe')
    for (const path of ['/my-reviews', '/my-reviews/a1', '/my-reviews/a1/album']) expect(screenFor(path), path).toBeNull()
  })

  it('reports how a link was shared only from the fixed list', () => {
    expect(viaFrom('?via=email')).toBe('email')
    expect(viaFrom('?via=WhatsApp&x=1')).toBe('whatsapp')
    expect(viaFrom('?via=someone@example.com')).toBeNull()
    expect(viaFrom('?utm_source=newsletter')).toBeNull()
    expect(viaFrom('')).toBeNull()
  })

  it('keeps the address of public pages, so organisers see which retreats are read', () => {
    expect(screenFor('/')).toBe('/')
    expect(screenFor('/o/balance-beyond/r/india-2026')).toBe('/o/balance-beyond/r/india-2026')
    expect(screenFor('/o/balance-beyond')).toBe('/o/balance-beyond')
    expect(screenFor('/stories/a-week-in-kerala')).toBe('/stories/a-week-in-kerala')
  })

  it('reports where visitors came from as an origin, and nothing for Croot itself', () => {
    expect(referrerOrigin('https://www.instagram.com/p/xyz?igsh=1', 'https://croot.cx')).toBe('https://www.instagram.com/')
    expect(referrerOrigin('https://croot.cx/invite/tok', 'https://croot.cx')).toBe('')
    expect(referrerOrigin('', 'https://croot.cx')).toBe('')
  })
})
