-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'organiser');

-- CreateEnum
CREATE TYPE "TenantRequestStatus" AS ENUM ('pending', 'approved', 'declined');

-- CreateEnum
CREATE TYPE "RetreatStatus" AS ENUM ('draft', 'collecting', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('draft', 'submitted', 'changes_requested', 'withdrawn');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('none', 'published', 'unpublished', 'withdrawn');

-- CreateEnum
CREATE TYPE "ConsentActor" AS ENUM ('attendee', 'organiser', 'system');

-- CreateEnum
CREATE TYPE "ChangeRequestKind" AS ENUM ('edit', 'withdraw');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "PublicationEventStatus" AS ENUM ('published', 'unpublished', 'withdrawn');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('guest', 'organiser');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrganisationStatus" NOT NULL DEFAULT 'active',
    "contactEmail" TEXT,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgDomain" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantRequest" (
    "id" UUID NOT NULL,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "message" TEXT,
    "status" "TenantRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "organisationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'organiser',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupToken" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retreat" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "locationSummary" TEXT NOT NULL DEFAULT '',
    "routeSummary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "itineraryUrl" TEXT,
    "retreatPageUrl" TEXT,
    "organiserName" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactPublic" BOOLEAN NOT NULL DEFAULT false,
    "privacyUrl" TEXT,
    "status" "RetreatStatus" NOT NULL DEFAULT 'draft',
    "inviteOpensAt" TIMESTAMP(3),
    "inviteClosesAt" TIMESTAMP(3),
    "inviteTtlDays" INTEGER NOT NULL DEFAULT 60,
    "draftEditingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicReviewsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "writingSlideshowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "heroSlideshowEnabled" BOOLEAN NOT NULL DEFAULT true,
    "showPublicRating" BOOLEAN NOT NULL DEFAULT false,
    "feedbackCategories" JSONB NOT NULL DEFAULT '[]',
    "aggregateThreshold" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retreat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendee" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "importBatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "attendeeId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "attendeeId" UUID NOT NULL,
    "status" "ResponseStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "storyText" TEXT NOT NULL DEFAULT '',
    "overallRating" INTEGER,
    "keepText" TEXT NOT NULL DEFAULT '',
    "changeText" TEXT NOT NULL DEFAULT '',
    "consentPublicText" BOOLEAN NOT NULL DEFAULT false,
    "consentFirstName" BOOLEAN NOT NULL DEFAULT false,
    "consentFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "consentMarketing" BOOLEAN NOT NULL DEFAULT false,
    "consentWordingVersion" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedSnapshot" JSONB,
    "receiptTokenHash" TEXT,
    "organiserMessage" TEXT,
    "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'none',
    "publicSlug" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRating" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "score" INTEGER,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FeedbackRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "wordingVersion" TEXT NOT NULL,
    "actor" "ConsentActor" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "kind" "ChangeRequestKind" NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationRevision" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "storyText" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "displayName" TEXT,
    "overallRating" INTEGER,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PublicationEventStatus" NOT NULL,
    "reason" TEXT,
    "reviewerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "responseId" UUID,
    "kind" "MediaKind" NOT NULL,
    "originalKey" TEXT NOT NULL,
    "derivativeKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "altText" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "credit" TEXT NOT NULL DEFAULT '',
    "publishConsent" BOOLEAN NOT NULL DEFAULT false,
    "moderation" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "focalX" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "focalY" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "inHeroSlideshow" BOOLEAN NOT NULL DEFAULT false,
    "inWritingSlideshow" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnonymousNote" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT,
    "receivedWeek" DATE NOT NULL,

    CONSTRAINT "AnonymousNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeRevision" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "presetKey" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'draft',
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRevision" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "headline" TEXT NOT NULL,
    "introParagraphs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ctaLabel" TEXT NOT NULL DEFAULT '',
    "ctaUrl" TEXT NOT NULL DEFAULT '',
    "status" "RevisionStatus" NOT NULL DEFAULT 'draft',
    "publishAt" TIMESTAMP(3),
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organisationId" UUID,
    "actorUserId" UUID,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrgDomain_hostname_key" ON "OrgDomain"("hostname");

-- CreateIndex
CREATE INDEX "OrgDomain_organisationId_idx" ON "OrgDomain"("organisationId");

-- CreateIndex
CREATE INDEX "TenantRequest_status_createdAt_idx" ON "TenantRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organisationId_idx" ON "Membership"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organisationId_key" ON "Membership"("userId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SetupToken_tokenHash_key" ON "SetupToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SetupToken_userId_idx" ON "SetupToken"("userId");

-- CreateIndex
CREATE INDEX "Retreat_organisationId_status_idx" ON "Retreat"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Retreat_organisationId_slug_key" ON "Retreat"("organisationId", "slug");

-- CreateIndex
CREATE INDEX "Attendee_organisationId_retreatId_idx" ON "Attendee"("organisationId", "retreatId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_retreatId_email_key" ON "Attendee"("retreatId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organisationId_attendeeId_idx" ON "Invitation"("organisationId", "attendeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_attendeeId_key" ON "Response"("attendeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_receiptTokenHash_key" ON "Response"("receiptTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Response_publicSlug_key" ON "Response"("publicSlug");

-- CreateIndex
CREATE INDEX "Response_organisationId_retreatId_status_idx" ON "Response"("organisationId", "retreatId", "status");

-- CreateIndex
CREATE INDEX "Response_organisationId_retreatId_publicationStatus_idx" ON "Response"("organisationId", "retreatId", "publicationStatus");

-- CreateIndex
CREATE INDEX "FeedbackRating_organisationId_idx" ON "FeedbackRating"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackRating_responseId_categoryKey_key" ON "FeedbackRating"("responseId", "categoryKey");

-- CreateIndex
CREATE INDEX "ConsentEvent_organisationId_responseId_idx" ON "ConsentEvent"("organisationId", "responseId");

-- CreateIndex
CREATE INDEX "ChangeRequest_organisationId_status_idx" ON "ChangeRequest"("organisationId", "status");

-- CreateIndex
CREATE INDEX "PublicationRevision_organisationId_retreatId_status_idx" ON "PublicationRevision"("organisationId", "retreatId", "status");

-- CreateIndex
CREATE INDEX "PublicationRevision_responseId_createdAt_idx" ON "PublicationRevision"("responseId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_organisationId_retreatId_kind_idx" ON "MediaAsset"("organisationId", "retreatId", "kind");

-- CreateIndex
CREATE INDEX "MediaAsset_responseId_idx" ON "MediaAsset"("responseId");

-- CreateIndex
CREATE INDEX "AnonymousNote_organisationId_retreatId_idx" ON "AnonymousNote"("organisationId", "retreatId");

-- CreateIndex
CREATE INDEX "ThemeRevision_organisationId_retreatId_status_idx" ON "ThemeRevision"("organisationId", "retreatId", "status");

-- CreateIndex
CREATE INDEX "ContentRevision_organisationId_retreatId_status_idx" ON "ContentRevision"("organisationId", "retreatId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "OrgDomain" ADD CONSTRAINT "OrgDomain_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupToken" ADD CONSTRAINT "SetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retreat" ADD CONSTRAINT "Retreat_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Response" ADD CONSTRAINT "Response_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRevision" ADD CONSTRAINT "PublicationRevision_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnonymousNote" ADD CONSTRAINT "AnonymousNote_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeRevision" ADD CONSTRAINT "ThemeRevision_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

