-- "Found this review helpful" votes. Like hearts: keyed by a hash of a random ID the visitor's browser
-- keeps, never an IP address or account. One per review per visitor.
CREATE TABLE "ReviewHelpful" (
    "responseId" UUID NOT NULL,
    "voterHash" TEXT NOT NULL,

    CONSTRAINT "ReviewHelpful_pkey" PRIMARY KEY ("responseId","voterHash")
);

ALTER TABLE "ReviewHelpful" ADD CONSTRAINT "ReviewHelpful_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE CASCADE ON UPDATE CASCADE;
