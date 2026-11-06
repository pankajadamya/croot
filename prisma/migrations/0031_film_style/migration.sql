-- The memory film's style (shared/film.ts): mix, single or dynamic.
ALTER TABLE "Retreat" ADD COLUMN "filmStyle" TEXT NOT NULL DEFAULT 'mix';
