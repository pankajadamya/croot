import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer.js'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, makeTenant, resetDatabase } from './helpers.js'

beforeEach(async () => {
  await resetDatabase()
  testOutbox.length = 0
})
afterAll(closeDatabase)

describe('reporting an album photo', () => {
  it('emails the owners once a day per item, and answers the same either way', async () => {
    const { org, retreat, user } = await makeTenant('alpha')
    const photo = await prisma.mediaAsset.create({
      data: { organisationId: org.id, retreatId: retreat.id, width: 10, height: 10, kind: 'album', originalKey: 'a/o', derivativeKey: 'a/w.webp', mime: 'image/webp', sizeBytes: 10 },
    })
    const report = (id: string, reason?: string) => request(app).post(`/api/public/media/${id}/report`).send(reason ? { reason } : {})

    expect((await report(photo.id, 'This is me, please remove it')).status).toBe(202)
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]).toMatchObject({ to: user.email, subject: `A photo in ${retreat.title} was reported` })
    expect(testOutbox[0].text).toContain('This is me, please remove it')
    expect(testOutbox[0].text).toContain(`/admin/alpha/retreats/${retreat.id}/site`)

    // A second report the same day is recorded but doesn't email again.
    expect((await report(photo.id)).status).toBe(202)
    expect(testOutbox).toHaveLength(1)
    expect(await prisma.auditEvent.count({ where: { action: 'media.reported', entityId: photo.id } })).toBe(2)

    // An unknown item gets the same answer, and nothing is sent.
    expect((await report('00000000-0000-4000-8000-000000000000')).status).toBe(202)
    expect(testOutbox).toHaveLength(1)
  })
})
