-- Private feedback categories an organiser removed, with their last name: guests' data exports
-- still label those ratings, and a category added later never reuses a removed one's key.
ALTER TABLE "Retreat" ADD COLUMN "removedFeedbackCategories" JSONB NOT NULL DEFAULT '[]';
