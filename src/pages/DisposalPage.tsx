import { useEffect, useState, type FormEvent } from 'react'
import { DatePicker } from '../components/DatePicker'
import { QtyStepper } from '../components/ProductPicker'
import { useAuth } from '../lib/auth'
import { useConfirm } from '../lib/confirm'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { usesDistribution } from '../lib/storeFeatures'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { MAX_QTY, errorMessage, formatDate, formatVND, monthStart, todayVN } from '../lib/format'
import type { DisposalLocation, StockStatusRow } from '../types/database'

const LOCATION_LABEL: Record<DisposalLocation, string> = { home: 'Ở nhà', shop: 'Ở quán', company: 'Ở công ty' }

const available = (row: StockStatusRow | undefined, location: DisposalLocation) =>
  !row ? 0 : location === 'home' ? row.qty_home : location === 'shop' ? row.qty_shop : row.qty_company

type HistoryRow = {
  id: string
  disposal_date: string
  product_id: string
  location: DisposalLocation
  quantity: number
  reason: string | null
  // Chỉ admin đọc được giá vốn từng lô (RLS); nhân viên nhận mảng rỗng
  stock_disposal_lines: { quantity: number; unit_cost: number }[]
}

// Nhập liệu → Hàng huỷ: ghi số hũ bỏ đi vì không đủ chất lượng bán (hỏng, phồng, hết hạn…).
// Trừ khỏi tồn ở nơi đang để, lấy từ lô cũ nhất trước; báo cáo Theo đợt nhập tính giá trị huỷ theo lô.
export function DisposalPage() {
  const { current } = useStore()
  return current ? <Disposals key={current.id} storeId={current.id} storeCode={current.code} /> : null
}

function Disposals({ storeId, storeCode }: { storeId: string; storeCode: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [date, setDate] = useState(todayVN())
  const [productId, setProductId] = useState('')
  const [location, setLocation] = useState<DisposalLocation>('shop')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => monthStart(todayVN()))
  const [history, setHistory] = useState<{ key: string; rows: HistoryRow[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const historyKey = `${storeId}|${from}|${version}`

  useEffect(() => {
    let cancelled = false
    let query = supabase
      .from('stock_disposals')
      .select('id, disposal_date, product_id, location, quantity, reason, stock_disposal_lines(quantity, unit_cost)')
      .eq('store_id', storeId)
    if (from) query = query.gte('disposal_date', from)
    query
      .order('disposal_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error: err }) => {
        if (cancelled) return
        setHistory({ key: historyKey, rows: (data ?? []) as unknown as HistoryRow[], error: err ? errorMessage(err) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, from, historyKey])

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const stocked = products.filter((p) => p.tracks_stock)
  const names = new Map(products.map((p) => [p.id, p.name]))
  const locations: DisposalLocation[] = usesDistribution(storeCode) ? ['home', 'shop', 'company'] : ['shop', 'home']
  const have = productId ? available(stock.get(productId), location) : 0
  const quantity = Number(qty) || 0
  const over = productId !== '' && quantity > have
  const rows = history?.key === historyKey ? history.rows : null
  const value = (r: HistoryRow) => r.stock_disposal_lines.reduce((s, l) => s + l.quantity * Number(l.unit_cost), 0)
  const totalQty = (rows ?? []).reduce((s, r) => s + r.quantity, 0)
  const totalValue = (rows ?? []).reduce((s, r) => s + value(r), 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!productId) return setFormError(t('Chọn món bị huỷ'))
    if (!Number.isInteger(quantity) || quantity <= 0) return setFormError(t('Số lượng huỷ phải lớn hơn 0'))
    if (quantity > MAX_QTY) return setFormError(t('Số lượng quá lớn, kiểm tra lại'))
    if (over) return setFormError(t('Vượt số đang có ({count})', { count: have }))
    setSaving(true)
    const { error: err } = await supabase.rpc('create_stock_disposal', {
      p_store_id: storeId,
      p_product_id: productId,
      p_location: location,
      p_quantity: quantity,
      p_disposal_date: date || null,
      p_reason: reason.trim() || null,
    })
    setSaving(false)
    if (err) return setFormError(errorMessage(err))
    toast.success(
      t('Đã ghi huỷ {count} {name} ngày {date}', { count: quantity, name: names.get(productId) ?? '', date: formatDate(date) }),
    )
    // Xoá form sau khi ghi để không ghi trùng lần huỷ; giữ ngày và nơi để vì hay nhập liền nhiều món
    setProductId('')
    setQty('1')
    setReason('')
    reload()
    setVersion((v) => v + 1)
  }

  const remove = async (r: HistoryRow) => {
    const ok = await confirm({
      title: t('Xoá lần huỷ'),
      message: t('Xoá lần huỷ {count} {name} ngày {date}? Số hũ sẽ được trả lại tồn kho.', {
        count: r.quantity,
        name: names.get(r.product_id) ?? '',
        date: formatDate(r.disposal_date),
      }),
      confirmText: t('Xoá'),
      cancelText: t('Đóng'),
      danger: true,
    })
    if (!ok) return
    const { error: err } = await supabase.rpc('delete_stock_disposal', { p_disposal_id: r.id })
    if (err) return toast.error(t(errorMessage(err)))
    toast.success(t('Đã xoá lần huỷ, hàng đã trả lại tồn kho'))
    reload()
    setVersion((v) => v + 1)
  }

  return (
    <section className="report-stack">
      <form className="card disposal-form" onSubmit={submit}>
        <h3>{t('Ghi hàng huỷ')}</h3>
        <p className="muted section-note">
          {t('Hàng không đủ chất lượng bán (hỏng, phồng nắp, hết hạn, đổ vỡ…). Số huỷ trừ khỏi tồn ở nơi đang để, lấy lô cũ nhất trước.')}
        </p>
        {stocked.length === 0 ? (
          <p className="pos-empty muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>
        ) : (
          <div className="disposal-grid">
            <div className="field">
              {t('Ngày huỷ')}
              <DatePicker value={date} onChange={setDate} max={todayVN()} label={t('Ngày huỷ')} />
            </div>
            <label className="field">
              {t('Món')}
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">{t('— Chọn món —')}</option>
                {stocked.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              {t('Nơi để')}
              <div className="segmented" role="radiogroup" aria-label={t('Nơi để')}>
                {locations.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    role="radio"
                    aria-checked={location === loc}
                    className={location === loc ? 'active' : undefined}
                    onClick={() => setLocation(loc)}
                  >
                    {t(LOCATION_LABEL[loc])}
                    {productId && <small> ({available(stock.get(productId), loc)})</small>}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              {t('Số lượng huỷ')}
              <QtyStepper value={qty} onChange={setQty} min={1} label={t('Số lượng huỷ')} />
              {over && <small className="warn">{t('Vượt số đang có ({count})', { count: have })}</small>}
            </div>
            <label className="field disposal-reason">
              {t('Lý do')}
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Không đủ chất lượng bán')} />
            </label>
          </div>
        )}
        {formError && <p className="error">{t(formError)}</p>}
        <button type="submit" className="primary" disabled={saving || stocked.length === 0 || over}>
          {saving ? t('Đang lưu…') : t('Ghi huỷ')}
        </button>
      </form>

      <div>
        <div className="filters">
          <h3>{t('Lịch sử huỷ hàng')}</h3>
          <div className="field">
            {t('Từ ngày')}
            <DatePicker value={from} onChange={setFrom} label={t('Từ ngày')} />
          </div>
          {from && (
            <button type="button" onClick={() => setFrom('')}>
              {t('Xem tất cả')}
            </button>
          )}
        </div>
        {history?.error ? (
          <p className="error">{t(history.error)}</p>
        ) : !rows ? (
          <p className="muted">{t('Đang tải…')}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{t('Chưa có lần huỷ hàng nào.')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('Ngày')}</th>
                  <th>{t('Món')}</th>
                  <th>{t('Nơi để')}</th>
                  <th className="num">{t('Số lượng')}</th>
                  {isAdmin && <th className="num">{t('Giá vốn')}</th>}
                  <th>{t('Lý do')}</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.disposal_date)}</td>
                    <td>{names.get(r.product_id) ?? '—'}</td>
                    <td>{t(LOCATION_LABEL[r.location])}</td>
                    <td className="num">{r.quantity}</td>
                    {isAdmin && <td className="num">{formatVND(value(r))}</td>}
                    <td className="wrap-cell">{r.reason ?? '—'}</td>
                    {isAdmin && (
                      <td>
                        <button type="button" className="link danger" onClick={() => remove(r)}>
                          {t('Xoá')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td colSpan={3}>{t('Tổng cộng')}</td>
                  <td className="num">{totalQty}</td>
                  {isAdmin && <td className="num">{formatVND(totalValue)}</td>}
                  <td colSpan={isAdmin ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
