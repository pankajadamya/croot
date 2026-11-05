import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

type Db = Prisma.TransactionClient | typeof prisma

export interface AuditInput {
  organisationId?: string | null
  actorUserId?: string | null
  actorKind: 'user' | 'attendee' | 'system' | 'platform'
  action: string
  entityType: string
  entityId?: string | null
  /** Safe metadata only: never tokens, emails, story text or private feedback. */
  metadata?: Record<string, unknown>
}

export async function audit(input: AuditInput, db: Db = prisma) {
  await db.auditEvent.create({
    data: {
      organisationId: input.organisationId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
}
