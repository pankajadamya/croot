-- The photo album is reached by an unguessable link (/album/<random>) rather than a predictable address
-- on the public site. Anyone with the link can view it, no sign-in. Organisers can replace the link.
ALTER TABLE "Retreat" ADD COLUMN "albumShareToken" TEXT;
CREATE UNIQUE INDEX "Retreat_albumShareToken_key" ON "Retreat"("albumShareToken");
