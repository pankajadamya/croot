import { describe, expect, it } from 'vitest'
import { landingFor } from './landing.js'

const admin = { isPlatformAdmin: true, memberships: [] }
const organiser = { isPlatformAdmin: false, memberships: [{ slug: 'balance-beyond' }] }
const twoOrgs = { isPlatformAdmin: false, memberships: [{ slug: 'a' }, { slug: 'b' }] }
const guest = { isPlatformAdmin: false, memberships: [] }

describe('where people land after signing in', () => {
  it('sends each person to their own home when nothing in particular was asked for', () => {
    expect(landingFor(null, admin)).toBe('/platform')
    expect(landingFor(null, organiser)).toBe('/admin/balance-beyond')
    expect(landingFor(null, twoOrgs)).toBe('/admin')
    expect(landingFor(null, guest)).toBe('/my-reviews')
  })

  it('ignores a page left over from the last person when this one cannot open it', () => {
    // An admin signed out of the console; an organiser signs in next.
    expect(landingFor('/platform', organiser)).toBe('/admin/balance-beyond')
    expect(landingFor('/admin/other-org/team', organiser)).toBe('/admin/balance-beyond')
    expect(landingFor('/admin', guest)).toBe('/my-reviews')
    expect(landingFor('/signin', organiser)).toBe('/admin/balance-beyond')
  })

  it('keeps a page the person can open, and refuses other sites', () => {
    expect(landingFor('/admin/balance-beyond/team', organiser)).toBe('/admin/balance-beyond/team')
    expect(landingFor('/admin/any-org', admin)).toBe('/admin/any-org')
    expect(landingFor('/invite/abc?edit=1', guest)).toBe('/invite/abc?edit=1')
    expect(landingFor('/organiser/request', guest)).toBe('/organiser/request')
    expect(landingFor('//evil.example', guest)).toBe('/my-reviews')
    expect(landingFor('https://evil.example', admin)).toBe('/platform')
  })
})
