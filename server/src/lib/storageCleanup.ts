import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * Deletes stored files. A failure (storage briefly unavailable) is never ignored: it's logged and the
 * key is queued in PendingStorageDeletion, which the daily retention job retries until it's gone.
 * Keys hold only ids (org/<id>/retreat/<id>/...), never personal details.
 */
export async function removeObjects(keys: Array<string | null | undefined>) {
  for (const key of new Set(keys.filter((k): k is string => Boolean(k)))) {
    try {
      await storage.remove(key)
    } catch (e) {
      const message = (e as Error).message?.slice(0, 500) ?? 'unknown error'
      console.error(`storage delete failed, queued for retry: ${key}: ${message}`)
      await prisma.pendingStorageDeletion.upsert({
        where: { key },
        update: { attempts: { increment: 1 }, lastError: message },
        create: { key, attempts: 1, lastError: message },
      })
    }
  }
}

/** Retries queued deletions. Returns how many were deleted and how many still fail. */
export async function retryPendingDeletions() {
  const pending = await prisma.pendingStorageDeletion.findMany({ orderBy: { createdAt: 'asc' }, take: 1000 })
  let deleted = 0
  let failing = 0
  for (const row of pending) {
    try {
      await storage.remove(row.key)
      await prisma.pendingStorageDeletion.delete({ where: { key: row.key } })
      deleted++
    } catch (e) {
      failing++
      await prisma.pendingStorageDeletion.update({ where: { key: row.key }, data: { attempts: { increment: 1 }, lastError: (e as Error).message?.slice(0, 500) } })
    }
  }
  if (failing) console.error(`storage deletes still failing after retry: ${failing} (see PendingStorageDeletion)`)
  return { deleted, failing }
}
