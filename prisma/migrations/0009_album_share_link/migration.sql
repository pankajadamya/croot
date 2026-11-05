-- AlterTable
ALTER TABLE "Retreat" ADD COLUMN     "albumShareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Retreat_albumShareToken_key" ON "Retreat"("albumShareToken");
