-- A hash of a random key the guest's browser makes for each anonymous note, so a retried send can't
-- create a duplicate. It's random per note and says nothing about who wrote it.
ALTER TABLE "AnonymousNote" ADD COLUMN "sendKeyHash" TEXT;
CREATE UNIQUE INDEX "AnonymousNote_sendKeyHash_key" ON "AnonymousNote"("sendKeyHash");
