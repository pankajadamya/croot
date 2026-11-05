/**
 * Local development seed. Fictional guests only: never put real attendee emails here.
 * Re-runnable: it wipes tenant data for the seeded organisations and recreates it.
 *
 * Prints the admin password (if generated) and a few invite links so the full flow can be tried.
 */
import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { DEFAULT_FEEDBACK_CATEGORIES, CONSENT_WORDING_VERSION, PROPERTY_FEEDBACK_CATEGORIES } from '../shared/categories.js'
import { THEME_PRESETS } from '../shared/themes.js'
import { autoExcerpt } from '../shared/excerpt.js'
import { env } from '../server/src/lib/env.js'
import { hashPassword } from '../server/src/lib/password.js'
import { closeDatabase, prisma } from '../server/src/lib/prisma.js'
import { issueInvitation } from '../server/src/lib/invites.js'
import { hashToken, newToken } from '../server/src/lib/tokens.js'

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || 'admin@croot.test').toLowerCase()

async function upsertUser(email: string, name: string, password: string, isPlatformAdmin = false) {
  const passwordHash = await hashPassword(password)
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, isPlatformAdmin, active: true },
    create: { email, name, passwordHash, isPlatformAdmin },
  })
}

async function resetOrg(slug: string, name: string) {
  await prisma.organisation.deleteMany({ where: { slug } })
  return prisma.organisation.create({ data: { slug, name, contactEmail: `hello@${slug}.test` } })
}

const STORIES = [
  {
    name: 'Anika Example',
    email: 'anika@guests.test',
    story:
      'The sunrise practice at Arkja is the moment that has stayed with me. Mist sat in the valley while we moved through a slow flow, and for the first time in months my mind was quiet. The Pilates sessions were thoughtfully paced, and the group felt like friends by day three. If you are wondering whether to come: bring layers, an open mind, and room in your suitcase for spices from Delhi.',
    consentFirstName: true,
    rating: 5,
  },
  {
    name: 'Maya Sample',
    email: 'maya@guests.test',
    story:
      'Seeing the Taj Mahal at dawn with people who had become close in just a few days was unforgettable. The teachers adapted every class to our different levels, which mattered to me as a beginner. Meals were vegetarian, fresh and generous.',
    consentFirstName: false,
    rating: 4,
  },
  {
    name: 'Tom Placeholder',
    email: 'tom@guests.test',
    story:
      'I came for the yoga and left with a new appreciation for slowing down. The travel days were long, but the organisers kept us informed and looked after us throughout. Would someone considering this retreat enjoy it? If you like early mornings and good company, absolutely.',
    consentFirstName: true,
    rating: null,
  },
]

async function seedBalanceAndBeyond(adminId: string) {
  const org = await resetOrg('balance-and-beyond', 'Balance & Beyond')
  await prisma.membership.create({ data: { userId: adminId, organisationId: org.id, role: 'owner' } })
  const organiser = await upsertUser('organiser@balance.test', 'Sample Organiser', 'organiser-dev-password')
  await prisma.membership.create({ data: { userId: organiser.id, organisationId: org.id, role: 'organiser' } })
  await prisma.orgDomain.deleteMany({ where: { hostname: 'reviews.balance.localhost' } })
  await prisma.orgDomain.create({ data: { organisationId: org.id, hostname: 'reviews.balance.localhost' } })

  const retreat = await prisma.retreat.create({
    data: {
      organisationId: org.id,
      slug: 'india-2026',
      title: 'India Yoga & Pilates Retreat',
      startDate: new Date('2026-10-23'),
      endDate: new Date('2026-11-01'),
      locationSummary: 'Delhi, Agra and Arkja near Dehradun',
      routeSummary: [
        'Arrive in Delhi: welcome and city culture',
        'Agra: the Taj Mahal and Mughal heritage',
        'Arkja near Dehradun: daily yoga, Pilates and meditation',
        'Return to Delhi and depart',
      ],
      itineraryUrl: 'https://www.balanceandbeyond.co.uk/retreat-in-india-oct-2026',
      retreatPageUrl: 'https://www.balanceandbeyond.co.uk/retreat-in-india-oct-2026',
      organiserName: 'Balance & Beyond',
      contactEmail: 'hello@balance.test',
      contactPublic: true,
      status: 'collecting',
      writingSlideshowEnabled: false,
      feedbackCategories: DEFAULT_FEEDBACK_CATEGORIES.map((c) =>
        c.key === 'accommodation' ? { ...c, label: 'Arkja accommodation and comfort' } : c.key === 'excursions' ? { ...c, label: 'Delhi/Agra cultural visits and excursions' } : c,
      ) as unknown as Prisma.InputJsonValue,
    },
  })

  await prisma.contentRevision.create({
    data: {
      organisationId: org.id,
      retreatId: retreat.id,
      status: 'published',
      headline: 'Ten days, three landscapes, one shared journey',
      introParagraphs: [
        'In October 2026 a small group travelled from the energy of Delhi to the calm of Arkja, practising yoga and Pilates along the way.',
        'These are their words, shared with permission. Each story is published exactly as the guest wrote it.',
      ],
      ctaLabel: 'Explore the retreat',
      ctaUrl: 'https://www.balanceandbeyond.co.uk/retreat-in-india-oct-2026',
      actorId: adminId,
    },
  })
  await prisma.themeRevision.create({
    data: { organisationId: org.id, retreatId: retreat.id, name: 'Forest & Linen', presetKey: 'forest-linen', tokens: THEME_PRESETS[0].tokens, status: 'published', actorId: adminId },
  })

  // Published sample stories (fictional guests).
  for (const s of STORIES) {
    const attendee = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name: s.name, email: s.email } })
    await issueInvitation(prisma, { organisationId: org.id, attendeeId: attendee.id, ttlDays: 60 })
    const response = await prisma.response.create({
      data: {
        organisationId: org.id,
        retreatId: retreat.id,
        attendeeId: attendee.id,
        status: 'submitted',
        storyText: s.story,
        overallRating: s.rating,
        keepText: 'The sunrise sessions and the small group size.',
        changeText: 'A little more free time in Agra.',
        consentPublicText: true,
        consentFirstName: s.consentFirstName,
        consentWordingVersion: CONSENT_WORDING_VERSION,
        submittedAt: new Date('2026-11-03T10:00:00Z'),
        receiptTokenHash: hashToken(newToken()),
        publicationStatus: 'published',
        publicSlug: `${s.consentFirstName ? s.name.split(' ')[0].toLowerCase() : 'story'}-${randomBytes(4).toString('hex')}`,
      },
    })
    await prisma.feedbackRating.createMany({
      data: DEFAULT_FEEDBACK_CATEGORIES.map((c, i) => ({
        organisationId: org.id,
        responseId: response.id,
        categoryKey: c.key,
        score: c.key === 'pilates' && i % 2 ? null : 3 + ((i + s.story.length) % 3),
        notApplicable: c.key === 'pilates' && i % 2 === 1,
      })),
    })
    await prisma.consentEvent.createMany({
      data: [
        { scope: 'public_text', granted: true },
        { scope: 'first_name', granted: s.consentFirstName },
      ].map((c) => ({ ...c, organisationId: org.id, responseId: response.id, wordingVersion: CONSENT_WORDING_VERSION, actor: 'attendee' as const })),
    })
    await prisma.publicationRevision.create({
      data: {
        organisationId: org.id,
        responseId: response.id,
        retreatId: retreat.id,
        storyText: s.story,
        excerpt: autoExcerpt(s.story, 200),
        displayName: s.consentFirstName ? s.name.split(' ')[0] : null,
        status: 'published',
        reviewerId: adminId,
      },
    })
  }

  // Guests still to respond: links printed below.
  const links: string[] = []
  for (const [name, email] of [
    ['Priya Fictional', 'priya@guests.test'],
    ['Sam Testperson', 'sam@guests.test'],
  ]) {
    const attendee = await prisma.attendee.create({ data: { organisationId: org.id, retreatId: retreat.id, name, email } })
    const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: attendee.id, ttlDays: 60 })
    links.push(`${name}: ${env.WEB_ORIGIN}/invite/${token}`)
  }

  await prisma.anonymousNote.createMany({
    data: [
      { message: 'The early starts were hard with jet lag. A gentler first morning would help.', category: 'instruction' },
      { message: 'One transfer felt rushed; more buffer time please.', category: 'travel' },
    ].map((n) => ({ ...n, organisationId: org.id, retreatId: retreat.id, receivedWeek: new Date('2026-11-02') })),
  })
  return links
}

async function seedSecondTenant() {
  const org = await resetOrg('demo-mountain-retreats', 'Demo Mountain Retreats')
  const owner = await upsertUser('owner@mountain.test', 'Demo Owner', 'mountain-dev-password')
  await prisma.membership.create({ data: { userId: owner.id, organisationId: org.id, role: 'owner' } })
  // A retreat property: guests review their own stays, all year round.
  const property = await prisma.retreat.create({
    data: {
      organisationId: org.id,
      slug: 'cedar-house',
      kind: 'property',
      title: 'Cedar House Retreat',
      locationSummary: 'A forest retreat house in the Chamonix valley',
      propertyAddress: 'Les Praz, Chamonix (sample address)',
      amenities: ['Yoga shala', 'Wood-fired sauna', 'Vegetarian kitchen', 'Forest trails'],
      organiserName: 'Demo Mountain Retreats',
      contactEmail: 'stay@mountain.test',
      contactPublic: true,
      status: 'collecting',
      feedbackCategories: PROPERTY_FEEDBACK_CATEGORIES as unknown as Prisma.InputJsonValue,
    },
  })
  await prisma.contentRevision.create({
    data: {
      organisationId: org.id,
      retreatId: property.id,
      status: 'published',
      headline: 'Stays at Cedar House, in our guests’ words',
      introParagraphs: ['Guests come for a weekend or a fortnight. Here is what they chose to share after their stay.'],
      actorId: owner.id,
    },
  })
  await prisma.themeRevision.create({
    data: { organisationId: org.id, retreatId: property.id, name: 'Mountain Mist', presetKey: 'mountain-mist', tokens: THEME_PRESETS[2].tokens, status: 'published', actorId: owner.id },
  })
  const story =
    'Three quiet nights at Cedar House were exactly the reset I needed. The morning class in the shala looked straight into the pines, and dinner was simple, warm and full of flavour. Bring walking boots for the forest trails.'
  const guest = await prisma.attendee.create({
    data: { organisationId: org.id, retreatId: property.id, name: 'Lena Sample', email: 'lena@guests.test', stayStart: new Date('2026-09-12'), stayEnd: new Date('2026-09-15') },
  })
  const resp = await prisma.response.create({
    data: {
      organisationId: org.id,
      retreatId: property.id,
      attendeeId: guest.id,
      status: 'submitted',
      storyText: story,
      consentPublicText: true,
      consentFirstName: true,
      consentWordingVersion: CONSENT_WORDING_VERSION,
      submittedAt: new Date('2026-09-17T09:00:00Z'),
      publicationStatus: 'published',
      publicSlug: `lena-${randomBytes(4).toString('hex')}`,
    },
  })
  await prisma.publicationRevision.create({
    data: { organisationId: org.id, responseId: resp.id, retreatId: property.id, storyText: story, excerpt: autoExcerpt(story, 200), displayName: 'Lena', status: 'published', reviewerId: owner.id },
  })
  const stayGuest = await prisma.attendee.create({
    data: { organisationId: org.id, retreatId: property.id, name: 'Omar Fictional', email: 'omar@guests.test', stayStart: new Date('2026-10-30'), stayEnd: new Date('2026-11-02') },
  })
  const { token } = await issueInvitation(prisma, { organisationId: org.id, attendeeId: stayGuest.id, ttlDays: 60 })

  await prisma.retreat.create({
    data: {
      organisationId: org.id,
      slug: 'alps-2027',
      title: 'Alpine Breath & Hike Week',
      startDate: new Date('2027-06-05'),
      endDate: new Date('2027-06-12'),
      locationSummary: 'Chamonix valley',
      organiserName: 'Demo Mountain Retreats',
      status: 'draft',
      feedbackCategories: DEFAULT_FEEDBACK_CATEGORIES as unknown as Prisma.InputJsonValue,
    },
  })
  return `Omar Fictional (property stay): ${env.WEB_ORIGIN}/invite/${token}`
}

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString('base64url')
  const admin = await upsertUser(ADMIN_EMAIL, 'Platform Admin', password, true)
  const links = await seedBalanceAndBeyond(admin.id)
  links.push(await seedSecondTenant())
  await prisma.tenantRequest.deleteMany({ where: { email: 'owner@lakeside.test' } })
  await prisma.tenantRequest.create({
    data: { orgName: 'Lakeside Wellness (sample request)', contactName: 'Request Sample', email: 'owner@lakeside.test', reviewKinds: ['property'], message: 'We run four retreats a year and would like to collect reviews here.' },
  })

  console.log('\nSeed complete (fictional data).')
  console.log(`  Platform admin + B&B owner: ${ADMIN_EMAIL} / ${process.env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : password}`)
  console.log('  B&B organiser:              organiser@balance.test / organiser-dev-password')
  console.log('  Second tenant owner:        owner@mountain.test / mountain-dev-password')
  console.log('  Invite links:')
  for (const l of links) console.log(`    ${l}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(closeDatabase)
