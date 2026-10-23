import { useEffect, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errorMessage, formatDate } from '../lib/format'
import type { CompanySetHistoryRow } from '../types/database'

type Kind = '' | 'shop' | 'company' | 'home'
type Transfer = { id: string; transfer_date: string; product_id: string; quantity: number; destination: string; note: string | null; created_at: string }
type Loaded = { key: string; transfers: Transfer[]; sets: CompanySetHistoryRow[]; names: Map<string, string> }

const KINDS: { value: Kind; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'shop', label: 'Ra quán' },
  { value: 'company', label: 'Cho công ty' },
  { value: 'home', label: 'Về nhà' },
]
const DIRECTION: Record<string, string> = { shop: 'Nhà → Quán', company: 'Nhà → Công ty', home: 'Quán → Nhà' }

// Tab Phân phối → Lịch sử: các lần chuyển hàng (ra quán, cho công ty, về nhà) và các set đã phân phối cho công ty
export function TransferHistory({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState({ from: '', to: '', kind: '' as Kind })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const badRange = filter.from !== '' && filter.to !== '' && filter.from > filter.to
  const filtered = filter.from !== '' || filter.to !== '' || filter.kind !== ''
  const key = `${storeId}|${filter.from}|${filter.to}|${filter.kind}`

  useEffect(() => {
    if (badRange) return
    let cancelled = false
    let query = supabase.from('stock_transfers').select('id, transfer_date, product_id, quantity, destination, note, created_at').eq('store_id', storeId)
    if (filter.from) query = query.gte('transfer_date', filter.from)
    if (filter.to) query = query.lte('transfer_date', filter.to)
    if (filter.kind) query = query.eq('destination', filter.kind)
    Promise.all([
      query.order('transfer_date', { ascending: false }).order('created_at', { ascending: false }).limit(filtered ? 500 : 100),
      supabase.rpc('get_company_sets_history', { p_store_id: storeId, p_from: filter.from || null, p_to: filter.to || null }),
      supabase.from('products').select('id, name').eq('store_id', storeId),
    ]).then(([transfers, sets, products]) => {
      if (cancelled) return
      const err = transfers.error ?? sets.error ?? products.error
      if (err) return setError(errorMessage(err))
      setError(null)
      setLoaded({
        key,
        transfers: (transfers.data ?? []) as Transfer[],
        sets: sets.data ?? [],
        names: new Map((products.data ?? []).map((p) => [p.id, p.name])),
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, key, badRange, filter.from, filter.to, filter.kind, filtered])

  const nameOf = (l: Loaded, id: string) => l.names.get(id) ?? '?'
  const mixText = (l: Loaded, mix: Record<string, number>) =>
    Object.entries(mix)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${n} ${nameOf(l, id)}`)
      .join(' + ')

  const data = loaded?.key === key ? loaded : null
  const showSets = filter.kind === '' || filter.kind === 'company'
  const sum = (kind: string) => (data?.transfers ?? []).filter((x) => x.destination === kind).reduce((s, x) => s + x.quantity, 0)

  return (
    <section className="report-stack">
      <div className="filters">
        <div className="preset-chips" role="group" aria-label={t('Loại')}>
          {KINDS.map((k) => (
            <button key={k.value} type="button" className={filter.kind === k.value ? 'active' : undefined} onClick={() => setFilter((f) => ({ ...f, kind: k.value }))}>
              {t(k.label)}
            </button>
          ))}
        </div>
        <div className="field">
          {t('Từ ngày')}
          <DatePicker value={filter.from} onChange={(v) => setFilter((f) => ({ ...f, from: v }))} label={t('Từ ngày')} />
        </div>
        <div className="field">
          {t('Đến ngày')}
          <DatePicker value={filter.to} onChange={(v) => setFilter((f) => ({ ...f, to: v }))} label={t('Đến ngày')} />
        </div>
        {filtered && (
          <button type="button" onClick={() => setFilter({ from: '', to: '', kind: '' })}>
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
          <div>
            <h2>{filtered ? t('Lịch sử chuyển hàng') : t('Lịch sử chuyển hàng gần nhất')}</h2>
            {data.transfers.length === 0 ? (
              <p className="muted">{filtered ? t('Không có lần chuyển nào khớp bộ lọc.') : t('Chưa có lần chuyển hàng nào.')}</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Ngày')}</th>
                        <th>{t('Hướng')}</th>
                        <th>{t('Món')}</th>
                        <th className="num">{t('Số lượng')}</th>
                        <th>{t('Ghi chú')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transfers.map((x) => (
                        <tr key={x.id}>
                          <td>{formatDate(x.transfer_date)}</td>
                          <td>
                            <span className={`badge ${x.destination === 'home' ? 'badge-warn' : x.destination === 'company' ? 'badge-low' : 'badge-ok'}`}>
                              {t(DIRECTION[x.destination] ?? x.destination)}
                            </span>
                          </td>
                          <td>{nameOf(data, x.product_id)}</td>
                          <td className="num">
                            <strong>{x.quantity}</strong>
                          </td>
                          <td>{x.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="expense-footer">
                  <span>
                    {t('Ra quán {shop} · Cho công ty {company} · Về nhà {home}', { shop: sum('shop'), company: sum('company'), home: sum('home') })}
                  </span>
                </p>
              </>
            )}
          </div>

          {showSets && (
            <div>
              <h2>{t('Set đã phân phối cho công ty')}</h2>
              {data.sets.length === 0 ? (
                <p className="muted">{t('Chưa phân phối set nào cho công ty.')}</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Ngày')}</th>
                        <th>{t('Set')}</th>
                        <th className="num">{t('Số set')}</th>
                        <th className="num">{t('Đã bán')}</th>
                        <th className="num">{t('Còn lại')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sets.map((s) => (
                        <tr key={s.id}>
                          <td>{formatDate(s.distribution_date)}</td>
                          <td>
                            <span className="badge badge-ok">{t('Set {size}', { size: s.set_size })}</span> {mixText(data, s.mix)}
                          </td>
                          <td className="num">{s.set_count}</td>
                          <td className="num">{s.sold_count}</td>
                          <td className="num">
                            <strong>{s.set_count - s.sold_count}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
