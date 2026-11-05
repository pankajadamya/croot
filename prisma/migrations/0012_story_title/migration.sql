-- Optional title a guest can give their review, and its published snapshot.
ALTER TABLE "Response" ADD COLUMN     "storyTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PublicationRevision" ADD COLUMN     "title" TEXT;
