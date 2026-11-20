import { BusFront, MapPin, X, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { assetUrl } from '../lib/urls'

export function Brand({ light = false }: { light?: boolean }) {
  const [logoLoaded, setLogoLoaded] = useState(false)
  return (
    <Link to="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="BUSTRA home">
      <span className={`brand-icon${logoLoaded ? ' brand-icon-image' : ''}`}>
        <img
          src={assetUrl('bustra-logo.png')}
          alt=""
          hidden={!logoLoaded}
          onLoad={() => {
            setLogoLoaded(true)
            const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
            if (favicon) {
              favicon.type = 'image/png'
              favicon.href = assetUrl('bustra-logo.png')
            }
          }}
          onError={() => setLogoLoaded(false)}
        />
        {!logoLoaded && <BusFront size={29} strokeWidth={1.7} />}
      </span>
      <span>
        BUSTRA<span className="brand-caption">A better way to get there.</span>
      </span>
    </Link>
  )
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {value === 'active' ? 'On route' : value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <MapPin size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'error' | 'success'
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Loading…
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    const previous = document.activeElement as HTMLElement | null
    return () => {
      dialog.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault()
        closeRef.current()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
