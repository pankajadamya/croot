-- The day a note arrived (date only, no time), so retention can delete it. Existing notes get today.
ALTER TABLE "AnonymousNote" ADD COLUMN     "receivedOn" DATE NOT NULL DEFAULT CURRENT_DATE;
