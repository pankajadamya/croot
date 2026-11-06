import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { umamiConfig, withUmami } from '../src/lib/analytics.js'
import { env } from '../src/lib/env.js'

const ID = '0f3c2b1a-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const html = '<html><head><title>Croot</title></head><body></body></html>'

describe('page statistics (Umami)', () => {
  const saved = env.UMAMI_WEBSITE_ID
  afterEach(() => {
    env.UMAMI_WEBSITE_ID = saved
  })

  it('is off unless a valid website id is configured', () => {
    expect(umamiConfig('')).toBeNull()
    expect(umamiConfig('not-a-uuid')).toBeNull()
    expect(umamiConfig(ID, 'javascript:alert(1)')).toBeNull()
    expect(withUmami(html, null)).toBe(html)
    expect(umamiConfig(ID, 'https://analytics.snaprows.dev/x')).toEqual({ origin: 'https://analytics.snaprows.dev', websiteId: ID })
  })

  it('adds the script with automatic tracking off, so real addresses (tokens) are never sent', () => {
    const page = withUmami(html, umamiConfig(ID, 'https://analytics.snaprows.dev'))
    expect(page).toContain(`src="https://analytics.snaprows.dev/script.js" data-website-id="${ID}"`)
    expect(page).toContain('data-auto-track="false"')
    expect(page).toContain('data-do-not-track="true"')
    expect(page.indexOf('script.js')).toBeLessThan(page.indexOf('</head>'))
  })

  it('the security policy allows Umami only when it is configured', async () => {
    env.UMAMI_WEBSITE_ID = ''
    const off = (await request(createApp()).get('/health/live')).headers['content-security-policy']
    expect(off).not.toContain('analytics.snaprows.dev')

    env.UMAMI_WEBSITE_ID = ID
    const on = (await request(createApp()).get('/health/live')).headers['content-security-policy']
    expect(on).toMatch(/script-src [^;]*https:\/\/analytics\.snaprows\.dev/)
    expect(on).toMatch(/connect-src [^;]*https:\/\/analytics\.snaprows\.dev/)
  })
})
