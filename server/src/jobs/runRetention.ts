/** `npm run retention`: apply retention policies once (e.g. from a cron job). */
import { closeDatabase } from '../lib/prisma.js'
import { runRetentionLocked } from './retention.js'

runRetentionLocked()
  .then((counts) => console.log(counts ? `retention: ${JSON.stringify(counts)}` : 'retention: another instance is running'))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(closeDatabase)
