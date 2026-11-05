import { createApp } from './app.js'
import { env } from './lib/env.js'
import { closeDatabase } from './lib/prisma.js'
import { scheduleRetention } from './jobs/retention.js'

const app = createApp()
// Retention runs in-process every 6 hours (advisory-locked, so several instances are safe).
if (env.NODE_ENV !== 'test') scheduleRetention()
const server = app.listen(env.PORT, () => {
  console.log(`croot API listening on :${env.PORT} (${env.NODE_ENV})`)
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, draining`)
  const force = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS)
  force.unref()
  server.close(async () => {
    await closeDatabase()
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
