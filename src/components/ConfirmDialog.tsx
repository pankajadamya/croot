import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** A red confirm button, for actions that remove or cancel something. */
  danger?: boolean
  /**
   * Runs inside the confirm button's own click, before the promise resolves. Use it for anything the
   * browser only allows during a click, such as writing to the clipboard.
   */
  onConfirm?: () => void
  /** For the most serious actions: the person must type this exact text before confirming. */
  typeToConfirm?: string
  /**
   * A question for the person to answer (a consent, say), not an action to confirm: one button per
   * answer, all alike and stacked, none focused first, and Esc or a click outside doesn't close it,
   * so the answer is always one of them. Asked with useChoice, which resolves to the chosen value.
   */
  choices?: Array<{ value: string; label: string }>
}

type Ask = (options: ConfirmOptions) => Promise<boolean>
type Answer = boolean | string

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<Answer>) | null>(null)

/**
 * In-app confirmation, in the app's own style, instead of the browser's plain `window.confirm`.
 * `const confirm = useConfirm(); if (await confirm({ title: '…' })) …`
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  // Outside the provider (shouldn't happen), fall back to the browser's own prompt.
  return useCallback<Ask>(
    async (o) => (ask ? Boolean(await ask(o)) : window.confirm(o.title)),
    [ask],
  )
}

/**
 * Asks a question with several equal answers and resolves to the chosen one's value:
 * `const answer = await choose({ title, message, choices: [{ value: 'yes', label: 'Yes' }, …] })`.
 */
export function useChoice() {
  const ask = useContext(ConfirmContext)
  return useCallback(
    async <T extends string>(o: Omit<ConfirmOptions, 'choices' | 'confirmLabel' | 'cancelLabel'> & { choices: Array<{ value: T; label: string }> }): Promise<T> => {
      if (!ask) return o.choices.at(-1)!.value
      return (await ask(o)) as T
    },
    [ask],
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (answer: Answer) => void }) | null>(null)
  const ask = useCallback((options: ConfirmOptions) => new Promise<Answer>((resolve) => setPending({ ...options, resolve })), [])
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <ConfirmModal
          options={pending}
          onDone={(answer) => {
            if (answer === true) pending.onConfirm?.()
            pending.resolve(answer)
            setPending(null)
          }}
        />
      )}
    </ConfirmContext.Provider>
  )
}

/** A native modal dialog: focus stays inside, Esc cancels, and focus returns to where it was. */
function ConfirmModal({ options, onDone }: { options: ConfirmOptions; onDone: (answer: Answer) => void }) {
  const choice = Boolean(options.choices?.length)
  const ref = useRef<HTMLDialogElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const blocked = Boolean(options.typeToConfirm) && typed.trim() !== options.typeToConfirm
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    // Destructive actions start on Cancel; a choice on its question; others on the main button.
    if (choice) d?.querySelector<HTMLElement>('#confirm-title')?.focus()
    else if (!options.danger && !options.typeToConfirm) confirmRef.current?.focus()
    return () => d?.close()
  }, [options.danger, options.typeToConfirm, choice])
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby={options.message ? 'confirm-message' : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (!choice) onDone(false)
      }}
      onClick={(e) => !choice && e.target === e.currentTarget && onDone(false)} // a click on the backdrop cancels
    >
      <div className="confirm-dialog-body">
        <h2 id="confirm-title" tabIndex={-1}>{options.title}</h2>
        {options.message && (
          <div id="confirm-message" className="confirm-dialog-message">
            {options.message}
          </div>
        )}
        {options.typeToConfirm && (
          <div className="field" style={{ marginTop: '1rem' }}>
            <label htmlFor="confirm-typed">
              Type <strong style={{ fontFamily: "ui-monospace, monospace" }}>{options.typeToConfirm}</strong> to confirm
            </label>
            <input
              id="confirm-typed"
              type="text"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !blocked && onDone(true)}
            />
          </div>
        )}
        {choice ? (
          <div className="confirm-dialog-choices">
            {options.choices!.map((c) => (
              <button key={c.value} type="button" className="btn secondary" onClick={() => onDone(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="confirm-dialog-actions">
            <button type="button" className="btn secondary" onClick={() => onDone(false)}>
              {options.cancelLabel ?? 'Cancel'}
            </button>
            <button ref={confirmRef} type="button" className={`btn ${options.danger ? 'danger' : ''}`} disabled={blocked} onClick={() => onDone(true)}>
              {options.confirmLabel ?? 'Continue'}
            </button>
          </div>
        )}
      </div>
    </dialog>
  )
}
