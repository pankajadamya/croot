-- Stored files whose deletion failed; retried by the retention job until they're gone.
CREATE TABLE "PendingStorageDeletion" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingStorageDeletion_pkey" PRIMARY KEY ("key")
);
