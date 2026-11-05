-- People who asked to hear about an organiser's next retreat. Double opt-in: only confirmed rows are
-- ever emailed. Unsubscribing deletes the row; unconfirmed rows are deleted after 30 days.
CREATE TABLE "InterestSignup" (
    "id" UUID NOT NULL,
    "organisationId" UUID NOT NULL,
    "retreatId" UUID,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "consentWording" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastMailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InterestSignup_tokenHash_key" ON "InterestSignup"("tokenHash");
CREATE UNIQUE INDEX "InterestSignup_organisationId_email_key" ON "InterestSignup"("organisationId", "email");

ALTER TABLE "InterestSignup" ADD CONSTRAINT "InterestSignup_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterestSignup" ADD CONSTRAINT "InterestSignup_retreatId_fkey" FOREIGN KEY ("retreatId") REFERENCES "Retreat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
