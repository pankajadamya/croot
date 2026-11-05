import { useId, useState } from 'react'
import { SCALE_LABELS } from '../../shared/categories'

const STAR_PATH = 'M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z'

/** Read-only stars, partly filled for averages (e.g. 4.3). */
export function Stars({ value, size = 18, label }: { value: number; size?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(5, value))
  return (
    <span className="stars" role="img" aria-label={label ?? `${formatRating(clamped)} out of 5 stars`} style={{ ['--star-size' as string]: `${size}px` }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, clamped - i))
        return (
          <span key={i} className="star" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="star-empty">
              <path d={STAR_PATH} />
            </svg>
            {fill > 0 && (
              <span className="star-fill" style={{ width: `${fill * 100}%` }}>
                <svg viewBox="0 0 24 24">
                  <path d={STAR_PATH} />
                </svg>
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

export function formatRating(n: number) {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/**
 * Star rating input: a native radio group (arrow keys, screen readers announce "4 stars, Very good"),
 * drawn as stars that fill up to the hovered or chosen one, with the word for it alongside.
 * Optional "Not applicable" and Clear, as before.
 */
export function StarInput({
  legend,
  value,
  notApplicable,
  onChange,
  allowNotApplicable = true,
  hideLegend = false,
}: {
  legend: string
  value: number | null
  notApplicable?: boolean
  onChange: (v: { score: number | null; notApplicable: boolean }) => void
  allowNotApplicable?: boolean
  hideLegend?: boolean
}) {
  const name = useId()
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? (notApplicable ? null : value)
  return (
    <fieldset className="star-input" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={hideLegend ? 'sr-only' : ''} style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
        {legend}
      </legend>
      <div className="star-input-row">
        <div className="star-input-stars" onMouseLeave={() => setHover(null)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={shown !== null && n <= shown ? 'on' : ''} onMouseEnter={() => setHover(n)}>
              <input type="radio" name={name} checked={!notApplicable && value === n} onChange={() => onChange({ score: n, notApplicable: false })} />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={STAR_PATH} />
              </svg>
              <span className="sr-only">
                {n} star{n === 1 ? '' : 's'}, {SCALE_LABELS[n]}
              </span>
            </label>
          ))}
        </div>
        <span className="star-input-word" aria-hidden="true">
          {shown ? SCALE_LABELS[shown] : notApplicable ? 'Not applicable' : ''}
        </span>
        {allowNotApplicable && (
          <label className="star-na">
            <input type="radio" name={name} checked={Boolean(notApplicable)} onChange={() => onChange({ score: null, notApplicable: true })} />
            <span>Not applicable</span>
          </label>
        )}
        {(value !== null || notApplicable) && (
          <button type="button" className="btn ghost small" onClick={() => onChange({ score: null, notApplicable: false })}>
            Clear
          </button>
        )}
      </div>
    </fieldset>
  )
}
