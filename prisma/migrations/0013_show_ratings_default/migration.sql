-- Star ratings show with published reviews by default (organisers can still turn them off).
ALTER TABLE "Retreat" ALTER COLUMN "showPublicRating" SET DEFAULT true;
UPDATE "Retreat" SET "showPublicRating" = true;
