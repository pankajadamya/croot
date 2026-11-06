import { CONSENT_WORDING_VERSION } from '../../shared/categories.js'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, prisma } from '../src/lib/prisma.js'
import { app, invite, makeTenant, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)
afterAll(closeDatabase)

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#7a9a8a' } }).png().toBuffer()

async function guestWithPhoto() {
  const { org, retreat } = await makeTenant('alpha')
  const { token } = await invite(org.id, retreat.id)
  const up = await request(app).post(`/api/invites/${token}/photos`).attach('photo', await png(), 'p.png')
  expect(up.status).toBe(201)
  return { token, photoId: up.body.id as string }
}

const revisionOf = async (token: string) => (await request(app).get(`/api/invites/${token}`)).body.response.revision as number

describe('using guest photos on the website and social media', () => {
  it('is off until the guest answers, and a review with photos cannot be sent unanswered', async () => {
    const { token, photoId } = await guestWithPhoto()
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: photoId } })).publishConsent).toBe(false)
    const view = await request(app).get(`/api/invites/${token}`)
    expect(view.body.response.consents.photoMarketing).toBeNull()

    // The form's autosave sends the unanswered question as null: accepted, still unanswered.
    const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: await revisionOf(token), consents: { photoMarketing: null } })
    expect(saved.status).toBe(200)
    const blocked = await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })
    expect(blocked.status).toBe(400)
    expect(blocked.body.details).toHaveProperty('photoMarketing')
  })

  it('"Yes" applies to every photo, including ones added afterwards, and is recorded', async () => {
    const { token, photoId } = await guestWithPhoto()
    const yes = await request(app).put(`/api/invites/${token}/draft`).send({ revision: await revisionOf(token), consents: { photoMarketing: true } })
    expect(yes.status).toBe(200)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: photoId } })).publishConsent).toBe(true)
    const later = await request(app).post(`/api/invites/${token}/photos`).attach('photo', await png(), 'q.png')
    expect(later.body.publishConsent).toBe(true)

    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: await revisionOf(token) })
    expect(sent.status).toBe(200)
    const event = await prisma.consentEvent.findFirstOrThrow({ where: { scope: 'photo_marketing' } })
    expect(event).toMatchObject({ granted: true, wordingVersion: CONSENT_WORDING_VERSION })

    // Withdrawing from the private response page turns it off for every photo.
    const off = await request(app).post(`/api/responses/${sent.body.receiptToken}/withdraw`).send({ scope: 'photo_marketing' })
    expect(off.status).toBe(200)
    expect(await prisma.mediaAsset.count({ where: { publishConsent: true } })).toBe(0)
    const receipt = await request(app).get(`/api/responses/${sent.body.receiptToken}`)
    expect(receipt.body.consents.photoMarketing).toBe(false)
  })

  it('"No" keeps photos off the website and social media but still lets the review be sent', async () => {
    const { token, photoId } = await guestWithPhoto()
    const no = await request(app).put(`/api/invites/${token}/draft`).send({ revision: await revisionOf(token), consents: { photoMarketing: false } })
    const sent = await request(app).post(`/api/invites/${token}/submit`).send({ revision: no.body.revision })
    expect(sent.status).toBe(200)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: photoId } })).publishConsent).toBe(false)
    expect(await prisma.consentEvent.findFirstOrThrow({ where: { scope: 'photo_marketing' } })).toMatchObject({ granted: false })
  })

  it("doesn't ask when there are no photos", async () => {
    const { org, retreat } = await makeTenant('alpha')
    const { token } = await invite(org.id, retreat.id)
    const saved = await request(app).put(`/api/invites/${token}/draft`).send({ revision: 0, keepText: 'Lovely' })
    expect((await request(app).post(`/api/invites/${token}/submit`).send({ revision: saved.body.revision })).status).toBe(200)
    expect(await prisma.consentEvent.count({ where: { scope: 'photo_marketing' } })).toBe(0)
  })
})
