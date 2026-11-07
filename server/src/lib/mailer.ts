import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { env } from './env.js'
import { prisma } from './prisma.js'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
  /** Becomes an SES message tag, so delivery events can be broken down by kind of mail. */
  category: 'login_code' | 'organiser' | 'interest' | 'invitation'
  /** Extra headers, e.g. List-Unsubscribe on marketing mail. */
  headers?: Record<string, string>
}

let ses: SESv2Client | undefined
/**
 * Credentials passed explicitly: the SDK's default chain would otherwise pick up any AWS_* variables
 * (e.g. an object-storage key) and sign SES calls with a key AWS has never heard of.
 */
function sesClient() {
  ses ??= new SESv2Client({
    region: env.SES_REGION,
    credentials: { accessKeyId: env.SES_ACCESS_KEY_ID, secretAccessKey: env.SES_SECRET_ACCESS_KEY },
  })
  return ses
}

/** Messages captured in tests instead of being sent. */
export const testOutbox: Mail[] = []
/** Recipients skipped because they're suppressed (tests). */
export const suppressedSkips: string[] = []

/**
 * Transactional email. "console" is for local development only (production refuses to start with
 * it, see env.ts); "resend" calls the Resend HTTP API. Bodies are never logged in production.
 * Returns the provider's message id (null when nothing was sent).
 */
export async function sendMail(mail: Mail): Promise<string | null> {
  // Tests: captured at once (some mail is sent without waiting, and tests read the outbox straight
  // after the request), then taken back out if the address turns out to be suppressed.
  if (env.NODE_ENV === 'test') testOutbox.push(mail)
  // An address that bounced for good or complained is never mailed again (lib/emailGuard.ts).
  const suppressed = await prisma.emailSuppression.findUnique({ where: { email: mail.to.trim().toLowerCase() }, select: { reason: true } })
  if (suppressed) {
    if (env.NODE_ENV === 'test') {
      testOutbox.splice(testOutbox.indexOf(mail), 1)
      suppressedSkips.push(mail.to)
    } else console.warn(`email (${mail.category}) not sent: the address is suppressed (${suppressed.reason})`)
    return null
  }
  if (env.NODE_ENV === 'test') return `test-${testOutbox.length}-${Date.now()}`
  if (env.EMAIL_PROVIDER === 'console') {
    console.log(`\n[dev email] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`)
    return null
  }
  if (env.EMAIL_PROVIDER === 'ses') {
    // SendEmail throws on every rejection (sandbox recipient, unverified sender, throttling).
    const sent = await sesClient().send(
      new SendEmailCommand({
        FromEmailAddress: env.EMAIL_FROM,
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: mail.html, Charset: 'UTF-8' }, Text: { Data: mail.text, Charset: 'UTF-8' } },
            ...(mail.headers ? { Headers: Object.entries(mail.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
          },
        },
        EmailTags: [{ Name: 'category', Value: mail.category }],
        ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
      }),
    )
    return sent.MessageId ?? null
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.headers ? { headers: mail.headers } : {}) }),
  })
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`)
  return ((await res.json().catch(() => null)) as { id?: string } | null)?.id ?? null
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A guest's invitation to review, with their private link. */
export function invitationEmail(opts: {
  to: string
  firstName: string
  retreatTitle: string
  from: string
  url: string
  expiresAt: Date
  kind: 'itinerary' | 'property'
  /** The organisation's privacy notice for guests (UK GDPR Art. 14: at the first communication). */
  privacyUrl: string
  /** The controller: the organisation's legal name and address when set, otherwise its name. */
  controller: string
  /** Days after which a guest who never responds is deleted. */
  nonResponderDays: number
}): Mail {
  const visit = opts.kind === 'property' ? 'stay' : 'retreat'
  const until = opts.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const text = [
    `Hello ${opts.firstName},`,
    '',
    `Thank you for joining ${opts.retreatTitle}. ${opts.from} would love to hear how your ${visit} was.`,
    '',
    `Share your thoughts here (it’s your own private link, so please don’t forward it): ${opts.url}`,
    '',
    'Every question is optional, your answers save as you go, and nothing is published unless you choose to share it.',
    `The link works until ${until}.`,
    '',
    '—',
    `Sent by Croot on behalf of ${opts.controller}, who invited you.`,
    `How your information is used: ${opts.privacyUrl}`,
    `Rather not take part? Just ignore this email. If you don’t respond, your details are deleted after ${opts.nonResponderDays} days.`,
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:540px;line-height:1.55">
<p>Hello ${escape(opts.firstName)},</p>
<p>Thank you for joining <strong>${escape(opts.retreatTitle)}</strong>. ${escape(opts.from)} would love to hear how your ${visit} was.</p>
<p><a href="${opts.url}" style="display:inline-block;background:#183D3B;color:#F8F5EF;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Share how it went</a></p>
<p style="color:#4A5F5A;font-size:14px">Every question is optional, your answers save as you go, and nothing is published unless you choose to share it. This is your own private link, so please don’t forward it. It works until ${escape(until)}.</p>
<hr style="border:0;border-top:1px solid #d9ded6;margin:24px 0">
<p style="color:#4A5F5A;font-size:13px">Sent by Croot on behalf of ${escape(opts.controller)}, who invited you. <a href="${opts.privacyUrl}">How your information is used</a>.<br>
Rather not take part? Just ignore this email. If you don’t respond, your details are deleted after ${opts.nonResponderDays} days.</p>
</div>`
  return { to: opts.to, subject: `How was ${opts.retreatTitle}?`, text, html, category: 'invitation' }
}

export function loginCodeEmail(to: string, code: string, purpose: 'signin' | 'signup', minutes: number): Mail {
  const action = purpose === 'signup' ? 'finish creating your Croot account' : 'sign in to Croot'
  const text = [
    `Your code to ${action} is:`,
    '',
    `    ${code}`,
    '',
    `It expires in ${minutes} minutes and can be used once.`,
    'If you didn’t ask for this, you can ignore this email. Nobody can sign in without the code.',
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:480px">
<p>Your code to ${escape(action)} is:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:16px 0">${escape(code)}</p>
<p>It expires in ${minutes} minutes and can be used once.</p>
<p style="color:#4A5F5A;font-size:14px">If you didn’t ask for this, you can ignore this email. Nobody can sign in without the code.</p>
</div>`
  return { to, subject: `${code} is your Croot code`, text, html, category: 'login_code' }
}

/** The organiser asked Croot to let a guest confirm their review is theirs (one link, single use). */
export function verificationRequestEmail(opts: { to: string; firstName: string; retreatTitle: string; from: string; url: string; controller: string }): Mail {
  const text = [
    `Hello ${opts.firstName},`,
    '',
    `Thank you for your review of ${opts.retreatTitle}. To show future guests it’s genuine, please confirm it’s yours:`,
    opts.url,
    '',
    'It takes one click. Confirming marks your review “Verified email”; nothing else changes. If you didn’t write a review, you can ignore this email.',
    '',
    '—',
    `Sent by Croot on behalf of ${opts.controller} (${opts.from}).`,
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:540px;line-height:1.55">
<p>Hello ${escape(opts.firstName)},</p>
<p>Thank you for your review of <strong>${escape(opts.retreatTitle)}</strong>. To show future guests it’s genuine, please confirm it’s yours.</p>
<p><a href="${opts.url}" style="display:inline-block;background:#183D3B;color:#F8F5EF;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Confirm my review</a></p>
<p style="color:#4A5F5A;font-size:14px">It takes one click. Confirming marks your review “Verified email”; nothing else changes. If you didn’t write a review, you can ignore this email.</p>
<hr style="border:0;border-top:1px solid #d9ded6;margin:24px 0">
<p style="color:#4A5F5A;font-size:13px">Sent by Croot on behalf of ${escape(opts.controller)} (${escape(opts.from)}).</p>
</div>`
  return { to: opts.to, subject: `Please confirm your review of ${opts.retreatTitle}`, text, html, category: 'invitation' }
}

/** A code for someone joining a retreat's group link, before they're added as a guest. */
export function groupJoinCodeEmail(to: string, code: string, retreatTitle: string, minutes: number): Mail {
  const text = [
    `Your code to share your review of ${retreatTitle} is: ${code}`,
    '',
    `It expires in ${minutes} minutes and can be used once.`,
    'We use your email only to confirm and manage your review: no marketing without your consent, and it’s never shared with anyone else.',
    'If you didn’t ask for this, you can ignore this email.',
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:480px">
<p>Your code to share your review of <strong>${escape(retreatTitle)}</strong> is:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:16px 0">${escape(code)}</p>
<p>It expires in ${minutes} minutes and can be used once.</p>
<p style="color:#4A5F5A;font-size:14px">We use your email only to confirm and manage your review: no marketing without your consent, and it’s never shared with anyone else. If you didn’t ask for this, you can ignore this email.</p>
</div>`
  return { to, subject: `${code} is your code for ${retreatTitle}`, text, html, category: 'login_code' }
}

/** To an organisation's owners when a group link is made: reviews must be genuine. */
export function groupLinkWarningEmail(opts: { to: string; orgName: string; retreatTitle: string; createdBy: string; expiresAt: Date; maxJoins: number; manageUrl: string }): Mail {
  // A link can last as little as an hour, so the time matters (UK time).
  const until = opts.expiresAt.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', timeZoneName: 'short' })
  const text = [
    `A group link was made for ${opts.retreatTitle} by ${opts.createdBy}. It works until ${until}, for up to ${opts.maxJoins} people.`,
    '',
    'Anyone with a group link can give their name and write a review, so please share it only with people who were there.',
    '',
    'Reviews must be genuine. Croot checks reviews for warning signs, such as addresses linked to your organisation or many reviews written in a burst. Organisations found posting or encouraging reviews that aren’t genuine can be suspended or removed from Croot, and their reviews taken down.',
    '',
    'Reviews from people not on your guest list can only be published after you confirm they were your guests.',
    '',
    `Manage or stop the link: ${opts.manageUrl}`,
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:560px;line-height:1.55">
<p>A group link was made for <strong>${escape(opts.retreatTitle)}</strong> by ${escape(opts.createdBy)}. It works until ${escape(until)}, for up to ${opts.maxJoins} people.</p>
<p>Anyone with a group link can give their name and write a review, so please share it only with people who were there.</p>
<p style="padding:12px 14px;background:#fdf3dc;border-left:4px solid #8a5a00"><strong>Reviews must be genuine.</strong> Croot checks reviews for warning signs, such as addresses linked to your organisation or many reviews written in a burst. Organisations found posting or encouraging reviews that aren’t genuine can be suspended or removed from Croot, and their reviews taken down.</p>
<p>Reviews from people not on your guest list can only be published after you confirm they were your guests.</p>
<p><a href="${opts.manageUrl}">Manage or stop the link</a></p>
</div>`
  return { to: opts.to, subject: `Group link made for ${opts.retreatTitle}: please keep reviews genuine`, text, html, category: 'organiser' }
}

/**
 * To the organisation's owners when a guest sends a review (or sends an update to it). Only who, where,
 * the rating and whether they agreed to publication: never their words, which stay inside Croot.
 */
export function newReviewEmail(opts: { to: string; guestName: string; retreatTitle: string; rating: number | null; publishable: boolean; photos: number; updated: boolean; reviewUrl: string }): Mail {
  const stars = opts.rating ? `${'★'.repeat(opts.rating)}${'☆'.repeat(5 - opts.rating)} (${opts.rating} of 5)` : 'No overall rating given'
  const sharing = opts.publishable ? 'They agreed to publish their story: it’s waiting for your approval.' : 'They kept their story private (feedback for you only).'
  const photos = opts.photos ? `They added ${opts.photos} photo${opts.photos === 1 ? '' : 's'}.` : ''
  const lead = opts.updated ? `${opts.guestName} updated their review of ${opts.retreatTitle}.` : `${opts.guestName} sent a review of ${opts.retreatTitle}.`
  const text = [lead, '', stars, sharing, ...(photos ? [photos] : []), '', `Read it: ${opts.reviewUrl}`].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:560px;line-height:1.55">
<p>${escape(lead)}</p>
<p style="font-size:18px;color:#8a5a00;margin:0">${escape(stars)}</p>
<p>${escape(sharing)}${photos ? ` ${escape(photos)}` : ''}</p>
<p><a href="${opts.reviewUrl}">Read the review</a></p>
</div>`
  const subject = opts.updated ? `${opts.guestName} updated their review of ${opts.retreatTitle}` : `New review from ${opts.guestName}: ${opts.retreatTitle}`
  return { to: opts.to, subject, text, html, category: 'organiser' }
}

/** A viewer reported a photo or video in an album: the organisers decide whether to take it down. */
export function mediaReportEmail(opts: { to: string; retreatTitle: string; reason: string; manageUrl: string; isVideo: boolean }): Mail {
  const what = opts.isVideo ? 'video' : 'photo'
  const text = [
    `Someone viewing the album for ${opts.retreatTitle} reported a ${what}.`,
    '',
    opts.reason ? `Their reason: ${opts.reason}` : 'They didn’t give a reason.',
    '',
    `Please have a look and remove it if it shouldn’t be there: ${opts.manageUrl}`,
    '',
    'Reports are anonymous. You’ll hear about the same item at most once a day.',
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;color:#183D3B;max-width:560px;line-height:1.55">
<p>Someone viewing the album for <strong>${escape(opts.retreatTitle)}</strong> reported a ${what}.</p>
<p>${opts.reason ? `Their reason: <em>${escape(opts.reason)}</em>` : 'They didn’t give a reason.'}</p>
<p><a href="${opts.manageUrl}">Look at the album</a> and remove it if it shouldn’t be there.</p>
<p style="color:#5b6b66;font-size:13px">Reports are anonymous. You’ll hear about the same item at most once a day.</p>
</div>`
  return { to: opts.to, subject: `A ${what} in ${opts.retreatTitle} was reported`, text, html, category: 'organiser' }
}
