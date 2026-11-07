-- Verified reviews: how each guest proved their email, the public badge, organiser verification
-- emails, and the retreat group link (people join with a code before they're added as guests).
CREATE TYPE "VerificationMethod" AS ENUM ('email_link', 'sign_in', 'code', 'organiser_request');

ALTER TABLE "Attendee" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'invited',
  ADD COLUMN "guestListConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailChangedAt" TIMESTAMP(3);

ALTER TABLE "Response" ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifyRequestsSent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Retreat" ADD COLUMN "groupLinkTokenHash" TEXT,
  ADD COLUMN "groupLinkCreatedAt" TIMESTAMP(3),
  ADD COLUMN "groupLinkExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Retreat_groupLinkTokenHash_key" ON "Retreat"("groupLinkTokenHash");

CREATE TABLE "ReviewVerification" (
  "id" UUID NOT NULL,
  "organisationId" UUID NOT NULL,
  "responseId" UUID NOT NULL,
  "method" "VerificationMethod" NOT NULL,
  "emailHash" TEXT NOT NULL,
  "addressSource" TEXT NOT NULL,
  "signals" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewVerification_responseId_idx" ON "ReviewVerification"("responseId");
CREATE INDEX "ReviewVerification_organisationId_createdAt_idx" ON "ReviewVerification"("organisationId", "createdAt");
CREATE INDEX "ReviewVerification_emailHash_idx" ON "ReviewVerification"("emailHash");
ALTER TABLE "ReviewVerification" ADD CONSTRAINT "ReviewVerification_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VerificationRequest" (
  "id" UUID NOT NULL,
  "responseId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "emailHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VerificationRequest_tokenHash_key" ON "VerificationRequest"("tokenHash");
CREATE INDEX "VerificationRequest_responseId_idx" ON "VerificationRequest"("responseId");
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GroupJoinCode" (
  "id" UUID NOT NULL,
  "retreatId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupJoinCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GroupJoinCode_retreatId_email_createdAt_idx" ON "GroupJoinCode"("retreatId", "email", "createdAt");
CREATE INDEX "GroupJoinCode_expiresAt_idx" ON "GroupJoinCode"("expiresAt");
