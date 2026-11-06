-- When a photo or video was taken (EXIF DateTimeOriginal, or a video's creation time), read before
-- the file's metadata is removed; nothing else from that metadata is kept. Null when unknown.
ALTER TABLE "MediaAsset" ADD COLUMN "takenAt" TIMESTAMP(3);
