-- Photos no longer keep a private 4K copy beside the web copy: originalKey is only set for videos.
-- Existing copies are deleted by the retention job, which then clears the key.
ALTER TABLE "MediaAsset" ALTER COLUMN "originalKey" DROP NOT NULL;
