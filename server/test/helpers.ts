import request from 'supertest'
import type { Prisma } from '@prisma/client'
import { createApp } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { hashPassword } from '../src/lib/password.js'
import { issueInvitation } from '../src/lib/invites.js'
import { DEFAULT_FEEDBACK_CATEGORIES } from '../../shared/categories.js'

export const app = createApp()

const TABLES = [
  'AuditEvent', 'AnonymousNote', 'PublicationRevision', 'ChangeRequest', 'ConsentEvent', 'FeedbackRating', 'MediaAsset', 'Response',
  'Invitation', 'Attendee', 'ThemeRevision', 'ContentRevision', 'Retreat', 'SetupToken', 'Session', 'Membership', 'OrgDomain',
  'TenantRequest', 'User', 'Organisation',
]

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`)
}

export async function makeTenant(slug: string, opts: { kind?: 'itinerary' | 'property' } = {}) {
  const org = await prisma.organisation.create({ data: { slug, name: slug } })
  const user = await prisma.user.create({ data: { email: `${slug}@owner.test`, name: `${slug} owner`, passwordHash: await hashPassword('correct horse battery') } })
  await prisma.membership.create({ data: { userId: user.id, organisationId: org.id, role: 'owner' } })
  const kind = opts.kind ?? 'itinerary'
  const retreat = await prisma.retreat.create({
    data: {
      organisationId: org.id,
      slug: 'trip',
      kind,
      title: `${slug} trip`,
      startDate: kind === 'itinerary' ? new Date('2026-10-23') : null,
      endDate: kind === 'itinerary' ? new Date('2026-11-01') : null,
      status: 'collecting',
      feedbackCategories: DEFAULT_FEEDBACK_CATEGORIES as unknown as Prisma.InputJsonValue,
    },
  })
  return { org, user, retreat }
}

export async function login(email: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email, password: 'correct horse battery' })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { agent, csrf: res.body.csrfToken as string }
}

export async function invite(orgId: string, retreatId: string, name = 'Guest Example', email = 'guest@example.test') {
  const attendee = await prisma.attendee.create({ data: { organisationId: orgId, retreatId, name, email } })
  const { token } = await issueInvitation(prisma, { organisationId: orgId, attendeeId: attendee.id, ttlDays: 30 })
  return { attendee, token }
}
