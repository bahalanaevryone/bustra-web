import { useEffect, useId, useRef, useState } from 'react'
import { MapPin, Search, Check, LoaderCircle } from 'lucide-react'
import type { SelectedLocation } from './scheduleRoutes'
import { searchLocations } from './geocoding'
import { errorMessage } from '../../lib/utils'
export function LocationSearch({
  name,
  value,
  onChange,
  onChooseMap,
  disabled = false,
  status,
}: {
  name: 'Origin' | 'Destination'
  value: SelectedLocation | null
  onChange: (p: SelectedLocation | null) => void
  onChooseMap: () => void
  disabled?: boolean
  status?: string
}) {
  const [query, setQuery] = useState(value?.label || ''),
    [editing, setEditing] = useState(false),
    [results, setResults] = useState<SelectedLocation[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [retry, setRetry] = useState(0)
  const id = useId(),
    wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (value) {
      setQuery(value.label)
      setEditing(false)
      setResults([])
      setOpen(false)
    }
  }, [value])
  useEffect(() => {
    if (!editing || disabled || query.trim().length < 3) {
      setBusy(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setError('')
      void searchLocations(query, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) {
            setResults(items)
            setActive(-1)
            setOpen(true)
            if (!items.length)
              setError('No matching addresses. Try a more specific search or choose on the map.')
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setResults([])
            setError(errorMessage(e))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 800)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, editing, retry, disabled])
  function choose(p: SelectedLocation) {
    onChange(p)
    setEditing(false)
    setQuery(p.label)
    setOpen(false)
    setError('')
  }
  return (
    <div
      className="location-search"
      ref={wrapper}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <div className="location-field-heading">
        <label htmlFor={`${id}-input`}>{name}</label>
        <button type="button" className="text-button" disabled={disabled} onClick={onChooseMap}>
          <MapPin size={15} />
          Choose on Map<span className="sr-only"> for {name}</span>
        </button>
      </div>
      <div className="location-input-wrap">
        <Search size={17} />
        <input
          id={`${id}-input`}
          name={`${name.toLowerCase()}_search`}
          value={query}
          placeholder="City, barangay, landmark or address"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-results`}
          aria-activedescendant={active >= 0 ? `${id}-result-${active}` : undefined}
          autoComplete="off"
          maxLength={500}
          disabled={disabled}
          onFocus={() => {
            if (results.length) setOpen(true)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setEditing(true)
            setOpen(false)
            setResults([])
            setError('')
            onChange(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && results.length) {
              e.preventDefault()
              setOpen(true)
              setActive((v) => (v + 1) % results.length)
            }
            if (e.key === 'ArrowUp' && results.length) {
              e.preventDefault()
              setActive((v) => (v <= 0 ? results.length - 1 : v - 1))
            }
            if (e.key === 'Escape' && open) {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (open && active >= 0) choose(results[active])
              else {
                setEditing(true)
                setRetry((v) => v + 1)
              }
            }
          }}
        />
        {busy && <LoaderCircle className="spin" size={17} />}
      </div>
      {open && results.length > 0 && (
        <div
          className="location-suggestions"
          role="listbox"
          id={`${id}-results`}
          aria-label={`${name} address suggestions`}
        >
          {results.map((p, i) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={active === i}
              id={`${id}-result-${i}`}
              key={`${p.label}-${p.lat}-${p.lng}`}
              onClick={() => choose(p)}
            >
              <MapPin size={16} />
              <span>
                {p.label}
                <small>
                  {p.lat.toFixed(6)}, {p.lng.toFixed(6)}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p className="form-help" role="status">
          Searching addresses…
        </p>
      )}
      {error && (
        <p className="location-message" role="status">
          {error}
        </p>
      )}
      {value && (
        <div className="selected-location">
          <p>
            <Check size={14} />
            <span>
              {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
            </span>
          </p>
          <label className="field">
            <span>{name} location label</span>
            <input
              value={value.label}
              maxLength={500}
              required
              disabled={disabled}
              placeholder="Enter a name for this position"
              onChange={(e) => onChange({ ...value, label: e.target.value, source: 'custom' })}
            />
          </label>
          <small>
            {status || 'Verify the pin on the map. Drag it to adjust the selected position.'}
          </small>
        </div>
      )}
      {!value && !error && !busy && (
        <p className="form-help">Select a search result or choose a position on the map.</p>
      )}
    </div>
  )
}
