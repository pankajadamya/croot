import { useId, type ReactNode } from 'react'
import { SCALE_LABELS } from '../../shared/categories'

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {/* State is shown by the knob position (not colour alone) and announced by role="switch"; no On/Off text. */}
        <span style={{ fontWeight: 600 }}>{label}</span>
        {description && <span className="muted small" style={{ display: 'block' }}>{description}</span>}
      </span>
    </label>
  )
}

/**
 * Five verbal anchors plus an optional "Not applicable". A native radio group, so arrow keys work
 * and screen readers announce the label; selection shows a tick, not just colour.
 */
export function RatingScale({
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
  return (
    <fieldset className="scale-wrap" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={hideLegend ? 'sr-only' : ''} style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
        {legend}
      </legend>
      <div className="scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input type="radio" name={name} checked={!notApplicable && value === n} onChange={() => onChange({ score: n, notApplicable: false })} />
            <span>
              {n}
              <small style={{ fontWeight: 400 }}>{n === 1 || n === 5 ? SCALE_LABELS[n] : ' '}</small>
            </span>
            {n !== 1 && n !== 5 && <span className="sr-only">{SCALE_LABELS[n]}</span>}
          </label>
        ))}
        {allowNotApplicable && (
          <label>
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

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {children}
      {error && (
        <span className="error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
