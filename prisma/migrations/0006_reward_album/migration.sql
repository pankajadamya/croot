-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'album';

-- AlterTable
ALTER TABLE "Retreat" ADD COLUMN     "rewardAlbumEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rewardAlbumNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rewardAlbumUrl" TEXT;

