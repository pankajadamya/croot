-- Protecting croot.cx's email reputation (lib/emailGuard.ts, modules/sesWebhook.ts).
CREATE TYPE "EmailProblem" AS ENUM ('bounced', 'complained');

-- Addresses never mailed again: a permanent bounce or a spam complaint reported by SES.
CREATE TABLE "EmailSuppression" (
  "email" TEXT NOT NULL,
  "reason" "EmailProblem" NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email")
);

-- Guest-facing email an organisation sent: for its daily limit, and to tie SES feedback back to it.
CREATE TABLE "EmailSend" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "messageId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailSend_organisationId_sentAt_idx" ON "EmailSend"("organisationId", "sentAt");
CREATE UNIQUE INDEX "EmailSend_messageId_key" ON "EmailSend"("messageId");

-- Bounces and complaints per organisation, for the admins' spike alert.
CREATE TABLE "EmailFeedback" (
  "id" UUID NOT NULL,
  "organisationId" UUID,
  "kind" "EmailProblem" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailFeedback_organisationId_createdAt_idx" ON "EmailFeedback"("organisationId", "createdAt");

ALTER TABLE "Organisation" ADD COLUMN "emailPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organisation" ADD COLUMN "dailyEmailLimit" INTEGER;
