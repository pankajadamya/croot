-- Organisers can choose to link the photo album from their public retreat and story pages.
ALTER TABLE "Retreat" ADD COLUMN     "albumOnPublicPage" BOOLEAN NOT NULL DEFAULT false;
