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

/**
 * How the memory film shows the photos, chosen by the organiser:
 *  - mix: photos on their own, pairs and collages (some as overlapping prints), keeping a big album to a few minutes;
 *  - single: every photo on its own, whole, with a gentle zoom (a big album makes a longer film);
 *  - dynamic: every photo on its own, filling the screen, with bolder zooms and pans across it.
 */
export const FILM_STYLES = [
  { id: 'mix', label: 'A mix', hint: 'Photos on their own, side by side and in collages, some as overlapping prints. Keeps a big album to a few minutes.' },
  { id: 'single', label: 'One at a time', hint: 'Every photo on its own and shown whole, with a gentle zoom. A big album makes a longer film.' },
  { id: 'dynamic', label: 'Moving', hint: 'Every photo on its own, filling the screen, with bolder zooms and pans across it. A little quicker.' },
] as const

export type FilmStyle = (typeof FILM_STYLES)[number]['id']
export const FILM_STYLE_IDS = FILM_STYLES.map((s) => s.id) as [FilmStyle, ...FilmStyle[]]
