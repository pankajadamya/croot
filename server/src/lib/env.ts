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
  /** Keys HMACs for sign-in codes and signs the short-lived OAuth state cookie. 32+ random characters; required in production. */
  AUTH_SECRET: z.string().min(32).optional(),
  /** With ORG_SIGNUP_ENABLED, new organisations go live without platform approval when true. */
  SIGNUP_AUTO_APPROVE: z.stringbool().default(false),
  /** Organiser self-service sign-up. Off: organisers are onboarded with one-time links from the platform console. */
  ORG_SIGNUP_ENABLED: z.stringbool().default(false),
  LOGIN_CODE_TTL_MINUTES: z.coerce.number().int().min(3).max(30).default(10),
  /** Email delivery: "console" prints messages to the server log (development only); "resend" uses the Resend API. */
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('croot <no-reply@croot.example>'),
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
/** Development fallback only; production refuses to start without AUTH_SECRET. */
export const authSecret = env.AUTH_SECRET ?? 'croot-development-only-auth-secret-not-for-production'
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const googleCallbackUrl = env.GOOGLE_CALLBACK_URL || `${env.WEB_ORIGIN}/api/auth/google/callback`
export const platformHosts = new Set(
  env.PLATFORM_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
)
