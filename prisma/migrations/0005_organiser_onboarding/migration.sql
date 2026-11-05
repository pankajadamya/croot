-- CreateEnum
CREATE TYPE "OrganiserRequestSource" AS ENUM ('request', 'invite');

-- AlterTable
ALTER TABLE "TenantRequest" ADD COLUMN     "country" TEXT,
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "source" "OrganiserRequestSource" NOT NULL DEFAULT 'request',
ADD COLUMN     "userId" UUID,
ADD COLUMN     "volume" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "OrganiserInvite" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisationId" UUID,
    "role" "MemberRole" NOT NULL DEFAULT 'owner',
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganiserInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganiserInvite_tokenHash_key" ON "OrganiserInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganiserInvite_email_idx" ON "OrganiserInvite"("email");

-- CreateIndex
CREATE INDEX "TenantRequest_userId_idx" ON "TenantRequest"("userId");

