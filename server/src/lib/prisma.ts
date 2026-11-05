import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

/** Explicit pool limits and timeouts: a slow query fails on its own instead of starving the instance. */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
})

export function poolStats() {
  return { max: env.DB_POOL_MAX, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
}

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

export async function closeDatabase() {
  await prisma.$disconnect()
  await pool.end().catch(() => {})
}
