/**
 * The album's "memory film": music an organiser can choose for it. The music is composed in the
 * viewer's browser as it plays (src/lib/filmMusic.ts), from Croot's own code: there are no audio
 * files, so no licence or credit to keep, and nothing is fetched from anywhere.
 */
export const FILM_MUSIC = [
  { id: 'calm', label: 'Calm morning', hint: 'Slow, airy chords. Suits yoga, sunrises and quiet places.' },
  { id: 'warm', label: 'Warm evening', hint: 'Mellow and unhurried. Suits sunsets, food and time together.' },
  { id: 'bright', label: 'Bright journey', hint: 'Lighter and moving. Suits travel, hikes and busy days.' },
  { id: 'none', label: 'No music', hint: 'Silent; videos keep their own sound.' },
] as const

export type FilmMusic = (typeof FILM_MUSIC)[number]['id']
export const FILM_MUSIC_IDS = FILM_MUSIC.map((m) => m.id) as [FilmMusic, ...FilmMusic[]]
