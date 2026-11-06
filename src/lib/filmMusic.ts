import type { FilmMusic } from '../../shared/film'

/**
 * Background music for the album memory film, composed in the browser with Web Audio as it plays:
 * soft pad chords, a low root note and a light arpeggio over a short echo. Croot's own code, so
 * there is no audio file, licence or credit, and nothing is downloaded. Each mood loops a chord
 * progression with small random variations, so it never repeats exactly.
 */

interface Mood {
  /** Chords as MIDI note numbers, lowest first. */
  chords: number[][]
  /** Seconds per chord. */
  bar: number
  /** Seconds between arpeggio notes, and how often a note is played (0–1). */
  step: number
  density: number
  pad: OscillatorType
  brightness: number
}

const MOODS: Record<Exclude<FilmMusic, 'none'>, Mood> = {
  // Cmaj7 – Am7 – Fmaj7 – G6/9
  calm: { chords: [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 57, 59]], bar: 5, step: 0.83, density: 0.55, pad: 'sine', brightness: 1100 },
  // Dmaj9 – Bm7 – Gmaj7 – A(sus)
  warm: { chords: [[50, 57, 61, 64], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 57, 59]], bar: 4.4, step: 0.55, density: 0.6, pad: 'triangle', brightness: 900 },
  // G – D/F# – Em7 – Cadd9
  bright: { chords: [[43, 55, 59, 62], [42, 54, 57, 62], [40, 55, 59, 62], [48, 55, 62, 64]], bar: 3.2, step: 0.4, density: 0.75, pad: 'triangle', brightness: 1600 },
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

export interface FilmMusicPlayer {
  /** Starts (or resumes) playing. Needs a user gesture first in most browsers. */
  play(): void
  pause(): void
  setMuted(muted: boolean): void
  /** Quieter while something else should be heard (0–1 of the normal level). */
  duck(level: number): void
  /** Fades out over a few seconds, then stops. */
  fadeOut(seconds?: number): void
  close(): void
}

export function createFilmMusic(mood: FilmMusic): FilmMusicPlayer | null {
  if (mood === 'none' || typeof window === 'undefined') return null
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  const m = MOODS[mood]
  const ctx = new Ctx()

  // master → (muted?) → speakers, with a soft echo send for space.
  const out = ctx.createGain()
  out.gain.value = 0
  const muteGain = ctx.createGain()
  const duckGain = ctx.createGain()
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = m.brightness * 2
  const compressor = ctx.createDynamicsCompressor()
  out.connect(duckGain).connect(muteGain).connect(tone).connect(compressor).connect(ctx.destination)
  const echo = ctx.createDelay(2)
  echo.delayTime.value = m.step * 1.5
  const feedback = ctx.createGain()
  feedback.gain.value = 0.32
  const echoTone = ctx.createBiquadFilter()
  echoTone.type = 'lowpass'
  echoTone.frequency.value = 1800
  const echoLevel = ctx.createGain()
  echoLevel.gain.value = 0.35
  echo.connect(echoTone).connect(feedback).connect(echo)
  echoTone.connect(echoLevel).connect(out)

  function voice(freq: number, start: number, length: number, level: number, type: OscillatorType, attack: number, cutoff: number, toEcho = false) {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    osc.detune.value = (Math.random() - 0.5) * 8
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(level, start + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(filter).connect(env).connect(out)
    if (toEcho) env.connect(echo)
    osc.start(start)
    osc.stop(start + length + 0.1)
  }

  let bar = 0
  let nextBarAt = 0
  let timer: number | null = null

  function scheduleBar(at: number) {
    const chord = m.chords[bar % m.chords.length]
    // Pad: the chord, slow in and out, overlapping the next one a little.
    chord.slice(1).forEach((n, i) => voice(hz(n), at, m.bar + 1.6, 0.05 - i * 0.006, m.pad, 1.4, m.brightness))
    // Root, an octave down, felt more than heard.
    voice(hz(chord[0] - 12), at, m.bar + 1, 0.07, 'sine', 0.6, 400)
    // Arpeggio: chord tones an octave up, sometimes skipped, so each pass differs.
    const tones = chord.slice(1).map((n) => n + 12)
    for (let t = 0, i = 0; t < m.bar - 0.05; t += m.step, i++) {
      if (Math.random() > m.density) continue
      const n = tones[(i + bar) % tones.length] + (Math.random() < 0.12 ? 12 : 0)
      voice(hz(n), at + t, 1.6, 0.035, 'sine', 0.012, 3200, true)
    }
    bar++
  }

  function tick() {
    // Look a bar and a half ahead, so timers that run late never leave a gap.
    while (nextBarAt < ctx.currentTime + m.bar * 1.5) {
      scheduleBar(nextBarAt)
      nextBarAt += m.bar
    }
  }

  const ramp = (param: AudioParam, value: number, seconds: number) => {
    param.cancelScheduledValues(ctx.currentTime)
    param.setValueAtTime(param.value, ctx.currentTime)
    param.linearRampToValueAtTime(value, ctx.currentTime + seconds)
  }

  let closed = false
  return {
    play() {
      if (closed) return
      void ctx.resume()
      if (timer === null) {
        nextBarAt = Math.max(nextBarAt, ctx.currentTime + 0.05)
        tick()
        timer = window.setInterval(tick, 400)
      }
      ramp(out.gain, 0.9, 2.5)
    },
    pause() {
      ramp(out.gain, 0, 0.6)
      if (timer !== null) window.clearInterval(timer)
      timer = null
      window.setTimeout(() => {
        if (timer === null && !closed) void ctx.suspend()
      }, 700)
    },
    setMuted(muted) {
      ramp(muteGain.gain, muted ? 0 : 1, 0.3)
    },
    duck(level) {
      ramp(duckGain.gain, Math.max(0, Math.min(1, level)), 0.8)
    },
    fadeOut(seconds = 4) {
      ramp(out.gain, 0, seconds)
      window.setTimeout(() => {
        if (timer !== null) window.clearInterval(timer)
        timer = null
      }, seconds * 1000)
    },
    close() {
      closed = true
      if (timer !== null) window.clearInterval(timer)
      timer = null
      void ctx.close()
    },
  }
}
