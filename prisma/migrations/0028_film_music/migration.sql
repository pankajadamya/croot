-- The album memory film's music, chosen by the organiser (shared/film.ts); "none" for silence.
ALTER TABLE "Retreat" ADD COLUMN "filmMusic" TEXT NOT NULL DEFAULT 'calm';
