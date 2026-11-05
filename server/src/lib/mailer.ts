import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { env } from './env.js'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
  /** Becomes an SES message tag, so delivery events can be broken down by kind of mail. */
  category: 'login_code' | 'organiser' | 'interest'
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

/**
 * Transactional email. "console" is for local development only (production refuses to start with
 * it, see env.ts); "resend" calls the Resend HTTP API. Bodies are never logged in production.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (env.NODE_ENV === 'test') {
    testOutbox.push(mail)
    return
  }
  if (env.EMAIL_PROVIDER === 'console') {
    console.log(`\n[dev email] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`)
    return
  }
  if (env.EMAIL_PROVIDER === 'ses') {
    // SendEmail throws on every rejection (sandbox recipient, unverified sender, throttling).
    await sesClient().send(
      new SendEmailCommand({
        FromEmailAddress: env.EMAIL_FROM,
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: mail.html, Charset: 'UTF-8' }, Text: { Data: mail.text, Charset: 'UTF-8' } },
          },
        },
        EmailTags: [{ Name: 'category', Value: mail.category }],
        ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
      }),
    )
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  })
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`)
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

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
