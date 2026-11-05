import { audit } from './audit.js'
import { env } from './env.js'
import { prisma } from './prisma.js'

/** Parses PLATFORM_ADMIN_EMAILS: trimmed, lower-cased, de-duplicated, valid-looking addresses only. */
export function configuredAdminEmails(raw = env.PLATFORM_ADMIN_EMAILS): string[] {
  return [...new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))]
}

/**
 * Makes sure every configured address has an account with super-admin rights. This is how the first
 * super admin exists on a fresh deployment. It only ever grants: demoting happens in the console, so
 * an old setting can't silently take access away, and nobody can lose access by a typo here.
 * The person then signs in with an email code or Google, which also verifies the address.
 */
export async function ensurePlatformAdmins(emails = configuredAdminEmails()) {
  const granted: string[] = []
  for (const email of emails) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing?.isPlatformAdmin && existing.active) continue
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { isPlatformAdmin: true, active: true } })
      : await prisma.user.create({ data: { email, name: email.split('@')[0], isPlatformAdmin: true } })
    await audit({ actorKind: 'system', action: 'platform_admin.granted_from_config', entityType: 'user', entityId: user.id })
    granted.push(email)
  }
  return granted
}
