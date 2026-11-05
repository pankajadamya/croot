export function slugify(input: string, maxLength = 48): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}

/** Organisation slugs that would collide with top-level routes. */
export const RESERVED_ORG_SLUGS = new Set([
  'admin',
  'api',
  'platform',
  'invite',
  'response',
  'stories',
  'media',
  'health',
  'o',
  'anonymous',
  'request-access',
])

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}
