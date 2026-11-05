-- Anonymous notes each organiser has seen, per programme, for the notifications bell.
ALTER TABLE "Membership" ADD COLUMN "seenNoteCounts" JSONB NOT NULL DEFAULT '{}';
