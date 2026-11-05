import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Links like /platform#pf-requests or a programme's #album-title: the page's content loads after
 * navigation, so wait (briefly) for the target to exist, then scroll to it.
 */
export function ScrollToHash() {
  const { hash, pathname } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let tries = 0
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 40) window.clearInterval(timer)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
    return () => window.clearInterval(timer)
  }, [hash, pathname])
  return null
}
