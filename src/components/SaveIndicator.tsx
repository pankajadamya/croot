/**
 * A small fixed-size save status (a spinner while saving, a tick once saved) that never moves the
 * content around it. The words are still announced to screen readers through a polite live region.
 */
export function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const words = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Couldn’t save' : ''
  return (
    <span className={`save-indicator is-${state}`} title={words || undefined}>
      {state === 'saving' && <span className="save-spinner" aria-hidden="true" />}
      {state === 'saved' && (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === 'error' && (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4.5v4.2M8 10.8v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      <span className="sr-only" aria-live="polite">
        {words}
      </span>
    </span>
  )
}
