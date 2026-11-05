// Loaded before any app module so env.ts validates against the test database, never the dev one.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:6433/postgres?sslmode=disable'
process.env.LOCAL_STORAGE_DIR = './.test-storage'
process.env.WEB_ORIGIN = 'http://localhost:6020'
process.env.DB_POOL_MAX = '3'
// Tests never inherit a developer's real providers from .env (dotenv does not override these).
Object.assign(process.env, {
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_CALLBACK_URL: '',
  EMAIL_PROVIDER: 'console',
  STORAGE_BACKEND: 'local',
  PLATFORM_ADMIN_EMAILS: '',
  ORG_SIGNUP_ENABLED: 'false',
  AUTH_SECRET: 'test-only-auth-secret-0123456789abcdef',
})
