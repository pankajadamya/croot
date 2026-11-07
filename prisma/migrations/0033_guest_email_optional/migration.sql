-- Guests can be added without an email address; the organiser shares their private link another way.
-- (retreatId, email) stays unique: Postgres allows any number of NULLs.
ALTER TABLE "Attendee" ALTER COLUMN "email" DROP NOT NULL;
