-- Platform-wide settings (one row), starting with album limits per retreat.
CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "albumMaxPhotos" INTEGER NOT NULL DEFAULT 50,
    "albumMaxVideos" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
