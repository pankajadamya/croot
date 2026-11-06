/**
 * Where someone goes after signing in. A requested page ("next", kept from before sign-in) is used
 * only when this person can open it; otherwise their own home: admins the admin console, organisers
 * their organisation, everyone else My reviews. So a page left over from whoever signed out last
 * (an admin's /platform, say) never greets the next person with "you don't have access".
 *
 * Shared by the sign-in page and the server's Google callback.
 */
export interface LandingPerson {
  isPlatformAdmin: boolean
  memberships: Array<{ slug: string }>
}

/** Only same-site paths, never another origin. */
export function safePath(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : null
}

export function homeFor(person: LandingPerson): string {
  if (person.isPlatformAdmin) return '/platform'
  if (person.memberships.length === 1) return `/admin/${person.memberships[0].slug}`
  if (person.memberships.length > 1) return '/admin'
  return '/my-reviews'
}

/** Whether this person can open the page at `path` (only the areas that need a role are checked). */
export function canOpen(path: string, person: LandingPerson): boolean {
  const pathname = path.split(/[?#]/)[0]
  if (pathname === '/platform' || pathname.startsWith('/platform/')) return person.isPlatformAdmin
  if (pathname === '/signin' || pathname === '/admin/login') return false
  const org = /^\/admin\/([^/]+)/.exec(pathname)?.[1]
  if (org && org !== 'setup') return person.isPlatformAdmin || person.memberships.some((m) => m.slug === org)
  if (pathname === '/admin') return person.isPlatformAdmin || person.memberships.length > 0
  return true
}

export function landingFor(next: unknown, person: LandingPerson): string {
  const path = safePath(next)
  return path && canOpen(path, person) ? path : homeFor(person)
}
