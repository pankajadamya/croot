import { Router } from 'express'
import { sendOrgMail } from '../../lib/emailGuard.js'
import { z } from 'zod'
import { audit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { HttpError, parseBody, route, text } from '../../lib/http.js'
import { announcementMail, unsubscribeTokenFor } from '../../lib/interest.js'
import { sendMail } from '../../lib/mailer.js'
import { prisma } from '../../lib/prisma.js'
import { tenantOf } from '../../middleware/auth.js'

/** People who asked to hear about the next retreat: the list, an export, and an email to all of them. */
export const interestRouter = Router({ mergeParams: true })

interestRouter.get(
  '/interest',
  route(async (req, res) => {
    const t = tenantOf(req)
    const [people, pending, lastSent] = await Promise.all([
      prisma.interestSignup.findMany({
        where: { organisationId: t.org.id, confirmedAt: { not: null } },
        orderBy: { confirmedAt: 'desc' },
        select: { id: true, email: true, name: true, confirmedAt: true, retreat: { select: { title: true } } },
      }),
      prisma.interestSignup.count({ where: { organisationId: t.org.id, confirmedAt: null } }),
      prisma.auditEvent.findFirst({ where: { organisationId: t.org.id, action: 'interest.emailed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])
    res.set('Cache-Control', 'no-store')
    res.json({
      people: people.map((p) => ({ id: p.id, email: p.email, name: p.name, confirmedAt: p.confirmedAt, from: p.retreat?.title ?? null })),
      pending,
      lastSentAt: lastSent?.createdAt ?? null,
    })
  }),
)

interestRouter.get(
  '/interest.csv',
  route(async (req, res) => {
    const t = tenantOf(req)
    const people = await prisma.interestSignup.findMany({
      where: { organisationId: t.org.id, confirmedAt: { not: null } },
      orderBy: { confirmedAt: 'desc' },
      include: { retreat: { select: { title: true } } },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'interest.exported', entityType: 'organisation', entityId: t.org.id, metadata: { count: people.length } })
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="interested-people.csv"', 'Cache-Control': 'no-store' })
    res.send(
      toCsv([
        ['Email', 'Name', 'Signed up from', 'Confirmed', 'Agreed to'],
        ...people.map((p) => [p.email, p.name, p.retreat?.title ?? '', p.confirmedAt?.toISOString() ?? '', p.consentWording]),
      ]),
    )
  }),
)

const NOTIFY_GAP_MS = 10 * 60 * 1000

/** Emails everyone confirmed. Each message has its own unsubscribe link. */
interestRouter.post(
  '/interest/notify',
  route(async (req, res) => {
    const t = tenantOf(req)
    const body = parseBody(
      z.object({
        subject: text(150).refine((s) => s.length >= 3, 'Add a subject'),
        message: text(5000).refine((s) => s.length >= 10, 'Write a little more'),
        test: z.boolean().optional(),
      }),
      req.body,
    )
    // A test goes only to the signed-in organiser, with a dummy unsubscribe link.
    if (body.test) {
      await sendMail(announcementMail(req.auth!.user.email, t.org, 'test-only-link', `[Test] ${body.subject}`, body.message))
      return res.json({ sent: 1, failed: 0, test: true })
    }
    const last = await prisma.auditEvent.findFirst({ where: { organisationId: t.org.id, action: 'interest.emailed' }, orderBy: { createdAt: 'desc' } })
    if (last && Date.now() - last.createdAt.getTime() < NOTIFY_GAP_MS) throw new HttpError(429, 'You emailed everyone a few minutes ago. Please wait a little before sending again.')
    const people = await prisma.interestSignup.findMany({ where: { organisationId: t.org.id, confirmedAt: { not: null } } })
    let sent = 0
    let failed = 0
    let stopped: string | null = null
    for (const p of people) {
      // The same unsubscribe link in every email, so older ones keep working.
      await prisma.interestSignup.update({ where: { id: p.id }, data: { lastMailAt: new Date() } })
      try {
        await sendOrgMail(t.org.id, announcementMail(p.email, t.org, unsubscribeTokenFor(p.id), body.subject, body.message))
        sent++
      } catch (e) {
        if (e instanceof HttpError && (e.status === 429 || e.message.includes('paused'))) {
          stopped = e.message
          break
        }
        failed++
      }
    }
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'interest.emailed', entityType: 'organisation', entityId: t.org.id, metadata: { sent, failed, subject: body.subject } })
    res.json({ sent, failed, stopped })
  }),
)
