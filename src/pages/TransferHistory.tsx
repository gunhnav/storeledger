import { useEffect, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errorMessage, formatDate } from '../lib/format'
import type { CompanySetHistoryRow } from '../types/database'

type Transfer = { transfer_date: string; product_id: string; quantity: number; destination: string; note: string | null }
// Ghi chú của bước tự chuyển quán -> nhà khi phân phối cho công ty mà nhà thiếu hàng (xem create_company_distribution)
const FROM_SHOP_NOTE = 'Lấy từ quán cho công ty'
type Item = { id: string; name: string }
type Loaded = { key: string; transfers: Transfer[]; sets: CompanySetHistoryRow[]; items: Item[] }

// Tab Phân phối → Lịch sử, hai phần riêng:
//  - Nhà: mỗi loại sữa chua một cột, mỗi ngày một dòng, ô là số hũ đã phân phối ra quán (chuyển về nhà hiện số âm)
//  - Công ty: theo từng ngày, mỗi set một dòng với số hũ từng loại trong 1 set, số set, đã bán, còn lại
export function TransferHistory({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState({ from: '', to: '' })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const badRange = filter.from !== '' && filter.to !== '' && filter.from > filter.to
  const filtered = filter.from !== '' || filter.to !== ''
  const key = `${storeId}|${filter.from}|${filter.to}`

  useEffect(() => {
    if (badRange) return
    let cancelled = false
    let query = supabase.from('stock_transfers').select('transfer_date, product_id, quantity, destination, note').eq('store_id', storeId)
    if (filter.from) query = query.gte('transfer_date', filter.from)
    if (filter.to) query = query.lte('transfer_date', filter.to)
    Promise.all([
      query.order('transfer_date', { ascending: false }).limit(2000),
      supabase.rpc('get_company_sets_history', { p_store_id: storeId, p_from: filter.from || null, p_to: filter.to || null }),
      supabase.from('products').select('id, name').eq('store_id', storeId).eq('tracks_stock', true).order('name'),
    ]).then(([transfers, sets, products]) => {
      if (cancelled) return
      const err = transfers.error ?? sets.error ?? products.error
      if (err) return setError(errorMessage(err))
      setError(null)
      setLoaded({ key, transfers: transfers.data ?? [], sets: sets.data ?? [], items: products.data ?? [] })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, key, badRange, filter.from, filter.to])

  const data = loaded?.key === key ? loaded : null

  return (
    <section className="report-stack">
      <div className="filters">
        <div className="field">
          {t('Từ ngày')}
          <DatePicker value={filter.from} onChange={(v) => setFilter((f) => ({ ...f, from: v }))} label={t('Từ ngày')} />
        </div>
        <div className="field">
          {t('Đến ngày')}
          <DatePicker value={filter.to} onChange={(v) => setFilter((f) => ({ ...f, to: v }))} label={t('Đến ngày')} />
        </div>
        {filtered && (
          <button type="button" onClick={() => setFilter({ from: '', to: '' })}>
            {t('Xoá lọc')}
          </button>
        )}
      </div>

      {badRange ? (
        <p className="error">{t('Khoảng ngày không hợp lệ: "Từ ngày" phải trước hoặc bằng "Đến ngày".')}</p>
      ) : error ? (
        <p className="error">{t(error)}</p>
      ) : !data ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : (
        <>
          <HomeHistory data={data} />
          <CompanyHistory data={data} />
        </>
      )}
    </section>
  )
}

function HomeHistory({ data }: { data: Loaded }) {
  const { t } = useI18n()
  // ngày -> món -> { ra quán, về nhà }
  const days = new Map<string, Map<string, { out: number; back: number }>>()
  for (const x of data.transfers) {
    if (x.destination !== 'shop' && x.destination !== 'home') continue
    // Hàng lấy từ quán cho công ty chỉ đi qua nhà trong một thao tác, không phải chuyển về nhà: tính ở phần Công ty
    if (x.destination === 'home' && x.note === FROM_SHOP_NOTE) continue
    const day = days.get(x.transfer_date) ?? new Map()
    const cell = day.get(x.product_id) ?? { out: 0, back: 0 }
    if (x.destination === 'shop') cell.out += x.quantity
    else cell.back += x.quantity
    day.set(x.product_id, cell)
    days.set(x.transfer_date, day)
  }
  const dates = [...days.keys()].sort().reverse()
  const total = (id: string) => dates.reduce((s, d) => s + (days.get(d)?.get(id)?.out ?? 0) - (days.get(d)?.get(id)?.back ?? 0), 0)
  const rowTotal = (d: string) => data.items.reduce((s, i) => s + (days.get(d)?.get(i.id)?.out ?? 0) - (days.get(d)?.get(i.id)?.back ?? 0), 0)
  const grand = data.items.reduce((s, i) => s + total(i.id), 0)

  return (
    <div>
      <h2>{t('Quán')}</h2>
      {dates.length === 0 ? (
        <p className="muted">{t('Chưa có lần phân phối ra quán nào.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                {data.items.map((i) => (
                  <th key={i.id} className="num">
                    {i.name}
                  </th>
                ))}
                <th className="num">{t('Tổng')}</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d}>
                  <td>{formatDate(d)}</td>
                  {data.items.map((i) => {
                    const c = days.get(d)?.get(i.id)
                    return (
                      <td key={i.id} className="num">
                        {c?.out ? <strong>{c.out}</strong> : <span className="muted">—</span>}
                        {c?.back ? <small className="warn"> −{c.back}</small> : null}
                      </td>
                    )
                  })}
                  <td className="num">
                    <strong>{rowTotal(d)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>{t('Tổng cộng')}</strong>
                </td>
                {data.items.map((i) => (
                  <td key={i.id} className="num">
                    <strong>{total(i.id)}</strong>
                  </td>
                ))}
                <td className="num">
                  <strong>{grand}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <small className="muted">{t('Số hũ đã phân phối ra quán mỗi ngày. Số nhỏ (−n) là hũ chuyển lại từ quán về nhà (mục Về nhà) trong ngày.')}</small>
    </div>
  )
}

function CompanyHistory({ data }: { data: Loaded }) {
  const { t } = useI18n()
  const byDate = new Map<string, CompanySetHistoryRow[]>()
  for (const s of data.sets) byDate.set(s.distribution_date, [...(byDate.get(s.distribution_date) ?? []), s])
  const dates = [...byDate.keys()].sort().reverse()
  // Hàng lấy thẳng từ quán cho công ty: ngày -> món -> số hũ
  const fromShop = new Map<string, Map<string, number>>()
  for (const x of data.transfers) {
    if (x.destination !== 'home' || x.note !== FROM_SHOP_NOTE) continue
    const day = fromShop.get(x.transfer_date) ?? new Map<string, number>()
    day.set(x.product_id, (day.get(x.product_id) ?? 0) + x.quantity)
    fromShop.set(x.transfer_date, day)
  }
  const names = new Map(data.items.map((i) => [i.id, i.name]))
  // Cùng các cột loại như bảng Quán để hai bảng thẳng hàng
  const cols = data.items
  // Tổng hũ của một dòng (mỗi loại × số set) và của cả bảng theo từng loại
  const jars = (r: CompanySetHistoryRow, id: string) => (r.mix[id] ?? 0) * r.set_count
  const colTotal = (id: string) => data.sets.reduce((s, r) => s + jars(r, id), 0)

  return (
    <div>
      <h2>{t('Công ty')}</h2>
      {dates.length === 0 ? (
        <p className="muted">{t('Chưa phân phối set nào cho công ty.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>{t('Set')}</th>
                {cols.map((i) => (
                  <th key={i.id} className="num">
                    {i.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const rows = byDate.get(d) ?? []
                const taken = [...(fromShop.get(d) ?? [])].map(([id, n]) => `${n} ${names.get(id) ?? '?'}`).join(', ')
                return [
                  <tr key={d} className="group-row">
                    <td>
                      <strong>{formatDate(d)}</strong>
                      {taken && <small className="muted"> · {t('Trong đó lấy từ hàng ở quán: {list}', { list: taken })}</small>}
                    </td>
                    {cols.map((i) => {
                      const sum = rows.reduce((n, r) => n + jars(r, i.id), 0)
                      return (
                        <td key={i.id} className="num">
                          <strong>{sum > 0 ? sum : '—'}</strong>
                        </td>
                      )
                    })}
                  </tr>,
                  ...rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="badge badge-ok">{t('Set {size}', { size: r.set_size })}</span>
                        {r.set_count > 1 && <small className="muted"> × {r.set_count}</small>}
                      </td>
                      {cols.map((i) => (
                        <td key={i.id} className="num">
                          {jars(r, i.id) > 0 ? <strong>{jars(r, i.id)}</strong> : <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  )),
                ]
              })}
              <tr className="total-row">
                <td>
                  <strong>{t('Tổng số hũ theo loại')}</strong>
                </td>
                {cols.map((i) => (
                  <td key={i.id} className="num">
                    <strong>{colTotal(i.id)}</strong>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <small className="muted">{t('Mỗi dòng là một loại set; số trong cột là số hũ từng loại (số hũ trong 1 set × số set). Dòng ngày là tổng hũ từng loại trong ngày.')}</small>
    </div>
  )
}
