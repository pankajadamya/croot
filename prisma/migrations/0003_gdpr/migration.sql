-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "originalPurgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "anonymousNoteRetentionMonths" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "auditRetentionMonths" INTEGER NOT NULL DEFAULT 36,
ADD COLUMN     "dpaAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "dpaVersion" TEXT,
ADD COLUMN     "dpoContact" TEXT,
ADD COLUMN     "draftRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "nonResponderRetentionDays" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "originalPhotoRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "privacyEmail" TEXT,
ADD COLUMN     "responseRetentionMonths" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "privateDataPurgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantRequest" ADD COLUMN     "termsVersion" TEXT;

