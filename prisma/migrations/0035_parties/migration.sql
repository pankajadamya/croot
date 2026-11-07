-- Who guests came with ("Travelled as a couple") and organiser-grouped parties of guests.
ALTER TABLE "Response" ADD COLUMN "travelledWith" TEXT NOT NULL DEFAULT 'solo',
  ADD COLUMN "partySize" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Attendee" ADD COLUMN "partyId" UUID;
CREATE INDEX "Attendee_partyId_idx" ON "Attendee"("partyId");
