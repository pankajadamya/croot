-- The photo album is now a public page of the retreat (/o/<org>/r/<retreat>/album): no share token or switch.
DROP INDEX IF EXISTS "Retreat_albumShareToken_key";
ALTER TABLE "Retreat" DROP COLUMN IF EXISTS "albumShareToken",
DROP COLUMN IF EXISTS "albumOnPublicPage";
