-- Small copies of photos for grids, and which group-link guest asked for each email code.
ALTER TABLE "MediaAsset" ADD COLUMN "thumbKey" TEXT;
ALTER TABLE "GroupJoinCode" ADD COLUMN "attendeeId" UUID;
ALTER TABLE "EmailSend" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'organiser';
