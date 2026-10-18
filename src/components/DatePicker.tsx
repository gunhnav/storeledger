import { useEffect, useRef, useState } from 'react'
import { addDays, monthStart, todayVN } from '../lib/format'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { Icon } from './Icon'

// Bộ chọn ngày theo giao diện của app (thay lịch gốc của trình duyệt).
// Giá trị dạng 'YYYY-MM-DD'; tuần bắt đầu thứ Hai; tên tháng / thứ theo ngôn ngữ đang chọn.
export function DatePicker({
  value,
  onChange,
  max,
  min,
  label,
  invalid,
}: {
  value: string
  onChange: (value: string) => void
  max?: string
  min?: string
  label: string
  invalid?: boolean
}) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const today = todayVN()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => monthStart(value || today))
  const ref = useRef<HTMLDivElement>(null)

  // Bấm ra ngoài hoặc Esc thì đóng
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (!open) setMonth(monthStart(value || today))
    setOpen((o) => !o)
  }

  const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(asDate(iso))

  const disabled = (iso: string) => (!!max && iso > max) || (!!min && iso < min)
  const choose = (iso: string) => {
    if (disabled(iso)) return
    onChange(iso)
    setOpen(false)
  }

  // Lưới 6 tuần, bắt đầu từ thứ Hai trước (hoặc bằng) ngày 1 của tháng
  const firstWeekday = (asDate(month).getUTCDay() + 6) % 7
  const gridStart = addDays(month, -firstWeekday)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const weekdays = cells.slice(0, 7).map((d) => fmt(d, { weekday: 'narrow' }))
  const monthIndex = month.slice(0, 7)

  return (
    <div className="date-picker" ref={ref}>
      <button
        type="button"
        className={`date-field${invalid ? ' invalid' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="calendar" size={18} />
        <span>
          {value ? fmt(value, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : t('Chọn ngày')}
        </span>
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label={label}>
          <div className="date-head">
            <button type="button" className="date-nav" aria-label={t('Tháng trước')} onClick={() => setMonth(monthStart(month, -1))}>
              ‹
            </button>
            <strong>{fmt(month, { month: 'long', year: 'numeric' })}</strong>
            <button
              type="button"
              className="date-nav"
              aria-label={t('Tháng sau')}
              disabled={!!max && monthStart(month, 1) > max}
              onClick={() => setMonth(monthStart(month, 1))}
            >
              ›
            </button>
          </div>
          <div className="date-grid">
            {weekdays.map((w, i) => (
              <span key={i} className="date-weekday">
                {w}
              </span>
            ))}
            {cells.map((iso) => {
              const classes = [
                'date-day',
                iso.slice(0, 7) !== monthIndex ? 'outside' : '',
                iso === today ? 'today' : '',
                iso === value ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={iso}
                  type="button"
                  className={classes}
                  disabled={disabled(iso)}
                  aria-pressed={iso === value}
                  aria-label={fmt(iso, { dateStyle: 'full' })}
                  onClick={() => choose(iso)}
                >
                  {Number(iso.slice(8))}
                </button>
              )
            })}
          </div>
          <div className="date-foot">
            <button type="button" className="link" disabled={disabled(today)} onClick={() => choose(today)}>
              {t('Hôm nay')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
