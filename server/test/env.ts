// Loaded before any app module so env.ts validates against the test database, never the dev one.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:6433/postgres?sslmode=disable'
process.env.LOCAL_STORAGE_DIR = './.test-storage'
process.env.WEB_ORIGIN = 'http://localhost:6020'
process.env.DB_POOL_MAX = '3'
