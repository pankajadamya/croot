import { useState, type ReactNode } from 'react'

/**
 * A large, friendly upload area: the whole box opens the file picker (on phones, the photo gallery),
 * and files can be dropped on it. Phones get the full-quality photo; nothing here forces the camera.
 */
export function UploadZone({
  id,
  title,
  hint,
  accept,
  multiple = true,
  busy,
  busyLabel,
  disabled,
  onFiles,
  children,
}: {
  id: string
  title: string
  hint: ReactNode
  accept: string
  multiple?: boolean
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  onFiles: (files: File[]) => void
  children?: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const off = Boolean(busy || disabled)
  return (
    <div
      className={`upload-zone ${dragging ? 'dragging' : ''} ${off ? 'is-off' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!off) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!off) onFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <input
        id={id}
        type="file"
        className="sr-only"
        multiple={multiple}
        accept={accept}
        disabled={off}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <label htmlFor={id}>
        <span className="upload-zone-icon" aria-hidden="true">
          {busy ? (
            <span className="upload-spinner" />
          ) : (
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </span>
        <span className="upload-zone-title">{busy ? (busyLabel ?? 'Uploading…') : title}</span>
        <span className="upload-zone-hint" id={`${id}-hint`}>
          {hint}
        </span>
      </label>
      {children}
    </div>
  )
}
