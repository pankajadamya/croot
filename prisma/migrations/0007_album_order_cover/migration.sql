-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "albumOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inAlbum" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Retreat" ADD COLUMN     "rewardAlbumCoverId" UUID;

