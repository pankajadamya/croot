import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(6021),
  /** Proxies in front of the app appending X-Forwarded-For (Traefik alone = 1; Cloudflare + Traefik = 2). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  WEB_ORIGIN: z.string().url().default('http://localhost:6020'),
  /** Hostnames that serve the platform itself; any other Host is looked up as a tenant custom domain. */
  PLATFORM_HOSTS: z.string().default('localhost,127.0.0.1'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_BUCKET: z.string().optional().default(''),
  S3_REGION: z.string().optional().default('auto'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  /** OVHcloud Object Storage uses virtual-hosted addressing (false); true only for providers that need path style. */
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  /** Keys HMACs for sign-in codes and signs the short-lived OAuth state cookie. 32+ random characters; required in production. */
  AUTH_SECRET: z.string().min(32).optional(),
  /**
   * Comma-separated emails that are made admins (platform admins) at start-up. Adds only:
   * removing an address here never demotes anyone (do that in the platform console).
   */
  PLATFORM_ADMIN_EMAILS: z.string().optional().default(''),
  /** With ORG_SIGNUP_ENABLED, new organisations go live without platform approval when true. */
  SIGNUP_AUTO_APPROVE: z.stringbool().default(false),
  /**
   * Anyone can create an account (email code or Google). An account alone gives only My reviews and the
   * "become an organiser" request; organiser access always needs an admin's approval or invite.
   */
  ACCOUNT_SIGNUP_ENABLED: z.stringbool().default(true),
  /** Organiser self-service sign-up. Off: organisers are onboarded with one-time links from the platform console. */
  ORG_SIGNUP_ENABLED: z.stringbool().default(false),
  LOGIN_CODE_TTL_MINUTES: z.coerce.number().int().min(3).max(30).default(10),
  /**
   * Email delivery, named as in Collab: "ses" (Amazon SES v2, the production choice), "resend", or
   * "console" (prints messages to the server log; development only, refused in production).
   */
  EMAIL_PROVIDER: z.enum(['console', 'ses', 'resend']).default('console'),
  /** The sender, e.g. `croot <no-reply@mail.snaprows.dev>`. Must sit inside a verified SES identity. */
  EMAIL_FROM: z.string().default('croot <no-reply@croot.example>'),
  /**
   * Amazon SES: an IAM user whose only permission is ses:SendEmail, separate from the object-storage
   * key. Optional configuration set for delivery, bounce and complaint events.
   */
  SES_REGION: z.string().optional().default(''),
  SES_ACCESS_KEY_ID: z.string().optional().default(''),
  SES_SECRET_ACCESS_KEY: z.string().optional().default(''),
  SES_CONFIGURATION_SET: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  /** Google sign-in (OAuth 2.0 / OpenID Connect). Both empty = Google sign-in hidden. */
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  /** Must match an authorised redirect URI in the Google console. Defaults to WEB_ORIGIN + /api/auth/google/callback. */
  GOOGLE_CALLBACK_URL: z.string().optional().default(''),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  MAX_PHOTOS_PER_RESPONSE: z.coerce.number().int().positive().default(8),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment:', z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'

if (isProduction && !env.AUTH_SECRET) {
  console.error('AUTH_SECRET is required in production')
  process.exit(1)
}
if (isProduction && env.EMAIL_PROVIDER === 'console') {
  console.error('EMAIL_PROVIDER=console would print sign-in codes to the log; configure a real provider in production')
  process.exit(1)
}
if (env.STORAGE_BACKEND === 's3') {
  const missing = (['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).filter((k) => !env[k])
  if (missing.length) {
    console.error(`STORAGE_BACKEND=s3 needs ${missing.join(', ')}`)
    process.exit(1)
  }
  if (env.S3_ENDPOINT) {
    const url = new URL(env.S3_ENDPOINT)
    // The access key signs requests, but the images themselves would cross the network in the clear.
    if (isProduction && url.protocol !== 'https:') {
      console.error('S3_ENDPOINT must use https in production')
      process.exit(1)
    }
    if (url.pathname !== '/' || url.search) {
      console.error('S3_ENDPOINT must be just a scheme and host, e.g. https://s3.eu-west-par.io.cloud.ovh.net')
      process.exit(1)
    }
  }
}
const EMAIL_REQUIRED = { ses: ['SES_REGION', 'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY'], resend: ['RESEND_API_KEY'] } as const
if (env.EMAIL_PROVIDER !== 'console') {
  const missing = EMAIL_REQUIRED[env.EMAIL_PROVIDER].filter((k) => !env[k])
  if (missing.length) {
    console.error(`EMAIL_PROVIDER=${env.EMAIL_PROVIDER} needs ${missing.join(', ')}`)
    process.exit(1)
  }
}
/** Development fallback only; production refuses to start without AUTH_SECRET. */
export const authSecret = env.AUTH_SECRET ?? 'croot-development-only-auth-secret-not-for-production'
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const googleCallbackUrl = env.GOOGLE_CALLBACK_URL || `${env.WEB_ORIGIN}/api/auth/google/callback`
export const platformHosts = new Set(
  env.PLATFORM_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
)
