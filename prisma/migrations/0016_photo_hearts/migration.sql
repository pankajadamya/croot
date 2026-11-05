-- Hearts on album photos. Visitors don't sign in: each heart is keyed by a hash of a random ID their
-- browser keeps, never an IP address or account. One heart per photo per visitor.
CREATE TABLE "PhotoHeart" (
    "photoId" UUID NOT NULL,
    "voterHash" TEXT NOT NULL,

    CONSTRAINT "PhotoHeart_pkey" PRIMARY KEY ("photoId","voterHash")
);

ALTER TABLE "PhotoHeart" ADD CONSTRAINT "PhotoHeart_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
