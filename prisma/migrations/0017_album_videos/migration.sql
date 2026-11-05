-- Organisers can add videos to the photo album. derivativeKey holds the video's poster image, so every
-- image view (thumbnails, teasers, covers) keeps working; the video file itself is at videoKey.
ALTER TABLE "MediaAsset" ADD COLUMN     "videoKey" TEXT,
ADD COLUMN     "durationSec" DOUBLE PRECISION;
