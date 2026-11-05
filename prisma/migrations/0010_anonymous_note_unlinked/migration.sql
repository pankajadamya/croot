-- Anonymous notes keep only the words: no category, week or time.
ALTER TABLE "AnonymousNote" DROP COLUMN "category",
DROP COLUMN "receivedWeek";
