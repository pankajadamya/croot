-- Recycle bin: a deleted guest and review (with photo rows) kept as a snapshot for 30 days; the files stay in storage until then.
CREATE TABLE "RecycledGuest" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID NOT NULL,
    "attendeeId" UUID NOT NULL,
    "guestName" TEXT NOT NULL,
    "hadReview" BOOLEAN NOT NULL DEFAULT false,
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "objectKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedById" UUID,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgeAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecycledGuest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecycledGuest_organisationId_retreatId_idx" ON "RecycledGuest"("organisationId", "retreatId");
CREATE INDEX "RecycledGuest_purgeAfter_idx" ON "RecycledGuest"("purgeAfter");
ALTER TABLE "RecycledGuest" ADD CONSTRAINT "RecycledGuest_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
