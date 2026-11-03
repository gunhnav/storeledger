import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { errorMessage, formatDate, formatVND, monthEnd, monthStart, todayVN } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import {
  customerNote,
  monthWeeks,
  summarizeByDay,
  sumQty,
  type CalendarDay,
  type CalendarOrder,
  type CalendarSaleRow,
} from '../lib/dailyCalendar'

type Loaded = { key: string; rows: CalendarSaleRow[]; names: Map<string, string> }

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

// Lịch tháng: mỗi ô ngày là tổng hũ từng loại đã bán (chỉ loại có bán); bấm ngày để xem Quán / Công ty
export function DailyCalendar({ storeId }: { storeId: string }) {
  const { t, lang } = useI18n()
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'vi-VN'
  const today = todayVN()
  const [month, setMonth] = useState(() => monthStart(today))
  const [selected, setSelected] = useState<string | null>(today)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const from = month
  const to = monthEnd(month)
  const key = `${storeId}|${from}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchAll<CalendarSaleRow>((a, b) =>
        supabase
          .from('sales')
          .select('id, sale_date, channel, total_amount, note, sale_items(product_id, quantity)')
          .eq('store_id', storeId)
          .gte('sale_date', from)
          .lte('sale_date', to)
          .order('sale_date')
          .order('id')
          .range(a, b),
      ),
      supabase.from('products').select('id, name').eq('store_id', storeId),
    ])
      .then(([rows, products]) => {
        if (cancelled) return
        if (products.error) throw products.error
        setError(null)
        setLoaded({ key, rows, names: new Map((products.data ?? []).map((p) => [p.id, p.name])) })
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [storeId, from, to, key])

  const data = loaded?.key === key ? loaded : null
  const days = useMemo(() => (data ? summarizeByDay(data.rows) : new Map<string, CalendarDay>()), [data])
  const weeks = useMemo(() => monthWeeks(month), [month])
  const name = (id: string) => data?.names.get(id) ?? '?'
  const sortedItems = (m: Map<string, number>) =>
    [...m].filter(([, q]) => q > 0).sort(([a], [b]) => name(a).localeCompare(name(b), 'vi'))
  const monthTotal = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of days.values()) for (const [id, q] of d.total) m.set(id, (m.get(id) ?? 0) + q)
    return m
  }, [days])

  const changeMonth = (offset: number) => {
    const next = monthStart(month, offset)
    setMonth(next)
    setSelected(next === monthStart(today) ? today : null)
  }
  const pick = (d: string) => {
    setSelected(d)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}T00:00:00Z`),
  )
  const day = selected ? days.get(selected) : undefined

  return (
    <section className="report-block cal">
      <div className="cal-head">
        <button type="button" onClick={() => changeMonth(-1)} aria-label={t('Tháng trước')}>
          ‹
        </button>
        <h2>{monthLabel}</h2>
        <button type="button" onClick={() => changeMonth(1)} aria-label={t('Tháng sau')}>
          ›
        </button>
        {month !== monthStart(today) && (
          <button type="button" onClick={() => { setMonth(monthStart(today)); setSelected(today) }}>
            {t('Tháng này')}
          </button>
        )}
      </div>

      {error ? (
        <p className="error">{t(error)}</p>
      ) : !data ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : (
        <>
          {monthTotal.size > 0 && (
            <p className="cal-month-total">
              <strong>{t('Cả tháng: {count} hũ', { count: sumQty(monthTotal) })}</strong>
              {' · '}
              {sortedItems(monthTotal).map(([id, q]) => `${name(id)} ${q}`).join(' · ')}
            </p>
          )}
          <div className="cal-grid" role="grid" aria-label={monthLabel}>
            {WEEKDAYS.map((w) => (
              <div key={w} className={`cal-weekday${w === 'CN' ? ' sunday' : ''}`} role="columnheader">
                {t(w)}
              </div>
            ))}
            {weeks.flat().map((d, i) => {
              if (!d) return <div key={`x${i}`} className="cal-cell empty" />
              const info = days.get(d)
              const items = info ? sortedItems(info.total) : []
              const className = ['cal-cell', d === today ? 'today' : '', d === selected ? 'selected' : '', d > today ? 'future' : '']
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={d}
                  type="button"
                  className={className}
                  onClick={() => pick(d)}
                  aria-current={d === today ? 'date' : undefined}
                  aria-pressed={d === selected}
                  aria-label={`${formatDate(d)}${info ? ` · ${t('{count} hũ', { count: sumQty(info.total) })}` : ''}`}
                >
                  <span className="cal-date">{Number(d.slice(8))}</span>
                  {items.length > 0 && (
                    <>
                      <ul className="cal-items">
                        {items.map(([id, q]) => (
                          <li key={id}>
                            <span>{name(id)}</span>
                            <b>{q}</b>
                          </li>
                        ))}
                      </ul>
                      <span className="cal-total">{t('{count} hũ', { count: sumQty(info!.total) })}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          <div ref={detailRef} className="cal-detail card">
            {!selected ? (
              <p className="muted">{t('Bấm vào một ngày để xem chi tiết Quán và Công ty.')}</p>
            ) : (
              <>
                <h3>{t('Ngày {date}', { date: formatDate(selected) })}</h3>
                {!day ? (
                  <p className="muted">{t('Không có đơn bán trong ngày này.')}</p>
                ) : (
                  <div className="cal-detail-cols">
                    <div>
                      <h4>
                        {t('Quán')} · {t('{count} hũ', { count: sumQty(day.shop) })}
                      </h4>
                      {day.shop.size === 0 ? (
                        <p className="muted">—</p>
                      ) : (
                        <ItemList items={sortedItems(day.shop)} name={name} />
                      )}
                      {day.shopOrders.some((o) => o.note) && (
                        <ul className="cal-orders">
                          {day.shopOrders.filter((o) => o.note).map((o) => (
                            <OrderLine key={o.id} order={o} name={name} note={o.note} />
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h4>
                        {t('Công ty')} · {t('{sets} set · {count} hũ', { sets: day.companySets, count: sumQty(day.company) })}
                      </h4>
                      {day.company.size === 0 ? (
                        <p className="muted">—</p>
                      ) : (
                        <>
                          <ItemList items={sortedItems(day.company)} name={name} />
                          <ul className="cal-orders">
                            {day.companyOrders.map((o) => (
                              <OrderLine key={o.id} order={o} name={name} note={customerNote(o.note)} />
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function ItemList({ items, name }: { items: [string, number][]; name: (id: string) => string }) {
  return (
    <ul className="cal-item-list">
      {items.map(([id, q]) => (
        <li key={id}>
          <span>{name(id)}</span>
          <b>{q}</b>
        </li>
      ))}
    </ul>
  )
}

function OrderLine({ order, name, note }: { order: CalendarOrder; name: (id: string) => string; note: string }) {
  const { t } = useI18n()
  const items = [...order.items].map(([id, q]) => `${q} ${name(id)}`).join(', ')
  return (
    <li>
      <div>
        {order.sets !== null && <strong>{t('{count} set', { count: order.sets })} · </strong>}
        {items} · {formatVND(order.total)}
      </div>
      {note && <div className="muted">{t('Ghi chú')}: {note}</div>}
    </li>
  )
}
