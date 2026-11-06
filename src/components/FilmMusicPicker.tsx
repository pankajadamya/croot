import { useEffect, useRef, useState } from 'react'
import { FILM_MUSIC, type FilmMusic } from '../../shared/film'
import { createFilmMusic, type FilmMusicPlayer } from '../lib/filmMusic'

const PREVIEW_MS = 15_000

/**
 * The memory film's music: each mood can be heard first (Listen plays about 15 seconds and saves
 * nothing), then chosen (which saves). One preview at a time; leaving the page stops it.
 */
export function FilmMusicPicker({ value, disabled, onChange }: { value: FilmMusic; disabled?: boolean; onChange: (music: FilmMusic) => void }) {
  const [playing, setPlaying] = useState<FilmMusic | null>(null)
  const player = useRef<FilmMusicPlayer | null>(null)
  const timer = useRef<number | null>(null)

  function stop() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    const p = player.current
    player.current = null
    if (p) {
      p.fadeOut(0.6)
      window.setTimeout(() => p.close(), 800)
    }
    setPlaying(null)
  }

  function listen(mood: FilmMusic) {
    const again = playing === mood
    stop()
    if (again) return
    const p = createFilmMusic(mood)
    if (!p) return
    player.current = p
    p.play()
    setPlaying(mood)
    // A short taste, fading out at the end.
    timer.current = window.setTimeout(() => {
      p.fadeOut(2)
      window.setTimeout(() => {
        p.close()
        if (player.current === p) {
          player.current = null
          setPlaying(null)
        }
      }, 2200)
    }, PREVIEW_MS)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  return (
    <fieldset className="film-music-picker">
      <legend>Music</legend>
      {FILM_MUSIC.map((m) => (
        <div key={m.id} className={`film-music-option ${value === m.id ? 'is-chosen' : ''}`}>
          <label>
            <input type="radio" name="film-music" value={m.id} checked={value === m.id} disabled={disabled} onChange={() => onChange(m.id)} />
            <span>
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
            </span>
          </label>
          {m.id !== 'none' && (
            <button type="button" className="btn ghost small" aria-pressed={playing === m.id} onClick={() => listen(m.id)} aria-label={`${playing === m.id ? 'Stop' : 'Listen to'} ${m.label}`}>
              {playing === m.id ? '■ Stop' : '▶ Listen'}
            </button>
          )}
        </div>
      ))}
      <p className="small muted" aria-live="polite" style={{ margin: '0.4rem 0 0' }}>
        {playing ? `Playing a short preview of ${FILM_MUSIC.find((m) => m.id === playing)?.label}. Listening doesn’t change your choice.` : 'Listen first if you like; choosing a mood saves it.'}
      </p>
    </fieldset>
  )
}
