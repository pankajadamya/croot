-- When Croot emailed this invitation link to the guest (null if the organiser copied it instead).
ALTER TABLE "Invitation" ADD COLUMN "emailedAt" TIMESTAMP(3);
