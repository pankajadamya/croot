import { useEffect, useState } from 'react'
import { firstName } from '../../../../shared/slug'

/**
 * Ways to send a guest their private link besides email (for guests without one, or who prefer it):
 * a WhatsApp message ready to send, or a QR code to show on screen or print. The link is the guest's
 * own, so it's only ever handed to WhatsApp or drawn here; nothing else sees it.
 */
export function ShareLink({ name, url, retreatTitle }: { name: string; url: string; retreatTitle: string }) {
  const [qr, setQr] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const message = `Hi ${firstName(name) || name}, thank you for joining ${retreatTitle}. We’d love to hear how it was. Here’s your own private link to share your review: ${url}`
  useEffect(() => {
    if (!showQr || qr) return
    let live = true
    // Loaded only when a QR code is asked for, to keep the page light.
    void import('qrcode').then((QR) => QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })).then((svg) => live && setQr(svg))
    return () => {
      live = false
    }
  }, [showQr, qr, url])
  return (
    <div className="share-link">
      <div className="row" style={{ gap: '0.4rem' }}>
        <a className="btn secondary small" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          Send on WhatsApp ↗
        </a>
        <button type="button" className="btn ghost small" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR code' : 'Show QR code'}
        </button>
      </div>
      {showQr && (
        <figure className="share-link-qr">
          {qr ? <div className="share-link-qr-code" role="img" aria-label={`QR code for ${name}’s review link`} dangerouslySetInnerHTML={{ __html: qr }} /> : <p className="small muted">Making the QR code…</p>}
          <figcaption className="small muted">{name} can scan this with their phone’s camera. It’s their own private link, so show it only to them.</figcaption>
        </figure>
      )}
    </div>
  )
}
