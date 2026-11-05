import { useEffect, useState } from 'react'
import { Calendar } from '../components/DatePicker'
import { useStore } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { supabase } from '../lib/supabase'
import { errorMessage, formatDate, formatVND, todayVN } from '../lib/format'
import { batchStats, type BatchStat } from '../lib/analytics/batches'
import { useAnalyticsData } from '../lib/useAnalyticsData'

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`)

export function BatchStatsPage() {
  const { current } = useStore()
  return current ? <BatchStats key={current.id} storeId={current.id} /> : null
}

// Chỉ admin: thống kê theo đợt nhập (mỗi purchase là một đợt), chỉ món đếm tồn
function BatchStats({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const { loading, error, data } = useAnalyticsData(storeId)
  // Ngày thanh toán vừa sửa trên trang (ghi đè dữ liệu đã tải, khỏi tải lại cả báo cáo)
  const [paidOverride, setPaidOverride] = useState<Record<string, string | null>>({})
  // Đợt đang mở hộp thoại thanh toán (index để hiện "Đợt n")
  const [paying, setPaying] = useState<{ batch: BatchStat; index: number } | null>(null)

  if (loading) return <p className="muted">{t('Đang tải…')}</p>
  if (error) return <p className="error">{t(error)}</p>
  if (!data) return null

  const stats = batchStats(data.input, data.allocations, data.currentPrice, data.today)
  const { totals } = stats
  const batches = stats.batches.map((b) => (b.purchaseId in paidOverride ? { ...b, paidOn: paidOverride[b.purchaseId] } : b))
  if (batches.length === 0) {
    return <p className="pos-empty muted">{t('Chưa có đợt nhập nào. Nhập hàng ở Kho hàng → Nhập hàng.')}</p>
  }

  const names = new Map(data.input.products.map((p) => [p.id, p.name]))
  // Cột "ngày hết" cho mỗi loại có xuất hiện trong ít nhất một đợt
  const productIds = data.input.products
    .filter((p) => batches.some((b) => b.lines.some((l) => l.productId === p.id)))
    .map((p) => p.id)

  const unpaidCost = batches.filter((b) => !b.paidOn).reduce((sum, b) => sum + b.cost, 0)
  const money = (v: number) => <span className={v < 0 ? 'negative' : undefined}>{formatVND(v)}</span>
  const status = (b: BatchStat) =>
    b.recovered ? (
      <span className="badge badge-ok">{t('Đã hoàn vốn')}</span>
    ) : (
      <span className="badge badge-low">{t('Chưa hoàn vốn')}</span>
    )
  const payment = (b: BatchStat, index: number) => (
    <div className="payment-cell">
      {b.paidOn ? (
        <span className="badge badge-ok">{t('Đã thanh toán')}</span>
      ) : (
        <span className="badge badge-low">{t('Chưa thanh toán')}</span>
      )}
      <button
        type="button"
        className={b.paidOn ? 'payment-btn' : 'payment-btn primary'}
        onClick={() => setPaying({ batch: b, index })}
      >
        {b.paidOn ? t('Sửa') : t('Thanh toán')}
      </button>
    </div>
  )
  const soldOut = (b: BatchStat) =>
    b.soldOutDate ? formatDate(b.soldOutDate) : t('Đang bán – ngày thứ {n}', { n: b.sellingDay ?? 0 })
  const notOut = (b: BatchStat) =>
    b.lines
      .filter((l) => l.remaining > 0)
      .map((l) => t('{name}: còn {count}', { name: names.get(l.productId) ?? '', count: l.remaining }))

  return (
    <section>
      <p className="muted section-note">
        {t('Mỗi đợt nhập là một dòng. Hũ bán được gán cho đợt cũ trước (FIFO); doanh thu là doanh thu thuần theo giá lúc bán.')}
      </p>
      {paying && (
        <PaymentDialog
          batch={paying.batch}
          index={paying.index}
          onClose={() => setPaying(null)}
          onSaved={(id, paidOn) => {
            setPaidOverride((m) => ({ ...m, [id]: paidOn }))
            setPaying(null)
          }}
        />
      )}
      <div className="table-wrap batch-wrap">
        <table className="batch-table">
          <thead>
            <tr>
              <th className="sticky-col">{t('Đợt nhập')}</th>
              <th className="num">{t('Tổng hũ')}</th>
              {productIds.map((id) => (
                <th key={id} className="num">
                  {t('Nhập: {name}', { name: names.get(id) ?? '' })}
                </th>
              ))}
              <th className="num">{t('Vốn nhập')}</th>
              <th>{t('Thanh toán')}</th>
              <th>{t('Ngày thanh toán')}</th>
              <th className="num">{t('Đã bán')}</th>
              <th className="num">{t('% đã bán')}</th>
              <th className="num">{t('Doanh thu')}</th>
              <th className="num">{t('Giá vốn hàng bán')}</th>
              <th className="num">{t('Lãi gộp')}</th>
              <th className="num">{t('Đã huỷ')}</th>
              <th className="num">{t('Giá trị huỷ')}</th>
              <th className="num">{t('Còn tồn')}</th>
              <th className="num">{t('Giá trị tồn')}</th>
              <th className="num">{t('% vốn thu hồi')}</th>
              <th>{t('Trạng thái')}</th>
              <th>{t('Ngày hoà vốn')}</th>
              <th className="num">{t('Lãi/lỗ nếu bán hết')}</th>
              <th>{t('Ngày hết cả đợt')}</th>
              <th className="num">{t('Số ngày bán hết')}</th>
              <th>{t('Loại hết trước')}</th>
              <th>{t('Loại hết sau cùng')}</th>
              <th>{t('Loại còn chưa hết')}</th>
              {productIds.map((id) => (
                <th key={id}>{t('Hết: {name}', { name: names.get(id) ?? '' })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={b.purchaseId}>
                <td className="sticky-col">
                  <strong>{t('Đợt {n}', { n: i + 1 })}</strong>
                  <small className="batch-date">{formatDate(b.date)}</small>
                  {b.note && <small className="muted batch-date">{b.note}</small>}
                </td>
                <td className="num">{b.totalQty}</td>
                {productIds.map((id) => (
                  <td key={id} className="num">
                    {b.lines.find((l) => l.productId === id)?.qty ?? '—'}
                  </td>
                ))}
                <td className="num">{formatVND(b.cost)}</td>
                <td>{payment(b, i)}</td>
                <td>{b.paidOn ? formatDate(b.paidOn) : '—'}</td>
                <td className="num">{b.sold}</td>
                <td className="num">{pct(b.soldPct)}</td>
                <td className="num">{formatVND(b.revenue)}</td>
                <td className="num">{formatVND(b.cogs)}</td>
                <td className="num">{money(b.grossProfit)}</td>
                <td className="num">{b.disposed || '—'}</td>
                <td className="num">{b.disposedValue ? money(-b.disposedValue) : '—'}</td>
                <td className="num">{b.remaining}</td>
                <td className="num">{formatVND(b.remainingValue)}</td>
                <td className="num">{pct(b.recoveryPct)}</td>
                <td>{status(b)}</td>
                <td>{b.breakEvenDate ? formatDate(b.breakEvenDate) : '—'}</td>
                <td className="num">{money(b.projectedProfit)}</td>
                <td>{soldOut(b)}</td>
                <td className="num">{b.daysToSellOut ?? '—'}</td>
                <td>{b.firstOutProductId ? names.get(b.firstOutProductId) : '—'}</td>
                <td>{b.lastOutProductId ? names.get(b.lastOutProductId) : '—'}</td>
                <td className="wrap-cell">
                  {notOut(b).length > 0 ? notOut(b).map((text) => <div key={text}>{text}</div>) : '—'}
                </td>
                {productIds.map((id) => {
                  const line = b.lines.find((l) => l.productId === id)
                  return (
                    <td key={id}>
                      {!line ? '' : line.soldOutDate ? formatDate(line.soldOutDate) : t('Còn {count} hũ', { count: line.remaining })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="sticky-col">{t('Tổng cộng')}</td>
              <td className="num">{totals.totalQty}</td>
              {productIds.map((id) => (
                <td key={id} className="num">
                  {batches.reduce((sum, b) => sum + (b.lines.find((l) => l.productId === id)?.qty ?? 0), 0)}
                </td>
              ))}
              <td className="num">{formatVND(totals.cost)}</td>
              <td colSpan={2} className="muted">
                {unpaidCost > 0 ? t('Chưa trả: {value}', { value: formatVND(unpaidCost) }) : ''}
              </td>
              <td className="num">{totals.sold}</td>
              <td className="num">{pct(totals.totalQty > 0 ? totals.sold / totals.totalQty : null)}</td>
              <td className="num">{formatVND(totals.revenue)}</td>
              <td className="num">{formatVND(totals.cogs)}</td>
              <td className="num">{money(totals.grossProfit)}</td>
              <td className="num">{totals.disposed}</td>
              <td className="num">{money(-totals.disposedValue)}</td>
              <td className="num">{totals.remaining}</td>
              <td className="num">{formatVND(totals.remainingValue)}</td>
              <td className="num">{pct(totals.cost > 0 ? totals.revenue / totals.cost : null)}</td>
              <td colSpan={8 + productIds.length} />
            </tr>
            <tr>
              <td className="sticky-col">{t('Trừ chi phí')}</td>
              <td colSpan={8 + productIds.length} />
              <td className="num">{money(-totals.expenses)}</td>
              <td colSpan={13 + productIds.length} />
            </tr>
            {totals.disposedValue > 0 && (
              <tr>
                <td className="sticky-col">{t('Trừ hàng huỷ')}</td>
                <td colSpan={8 + productIds.length} />
                <td className="num">{money(-totals.disposedValue)}</td>
                <td colSpan={13 + productIds.length} />
              </tr>
            )}
            <tr className="net-row">
              <td className="sticky-col">{t('Lợi nhuận ròng tất cả các đợt')}</td>
              <td colSpan={8 + productIds.length} />
              <td className="num">{money(totals.netProfit)}</td>
              <td colSpan={13 + productIds.length} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// Hộp thoại thanh toán một đợt nhập: chọn ngày trả tiền hàng trên lịch rồi xác nhận, hoặc bỏ đánh dấu.
// Hiện dạng modal vì bảng cuộn ngang sẽ cắt mất lịch nếu đặt trong ô.
function PaymentDialog({
  batch,
  index,
  onClose,
  onSaved,
}: {
  batch: BatchStat
  index: number
  onClose: () => void
  onSaved: (purchaseId: string, paidOn: string | null) => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState(batch.paidOn ?? todayVN())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (paidOn: string | null) => {
    setSaving(true)
    const { error } = await supabase.rpc('set_purchase_payment', { p_purchase_id: batch.purchaseId, p_paid_on: paidOn })
    setSaving(false)
    if (error) return toast.error(t(errorMessage(error)))
    onSaved(batch.purchaseId, paidOn)
    toast.success(
      paidOn
        ? t('Đợt {n}: đã thanh toán ngày {date}', { n: index + 1, date: formatDate(paidOn) })
        : t('Đợt {n}: chuyển về chưa thanh toán', { n: index + 1 }),
    )
  }

  return (
    <div className="confirm-backdrop" onClick={onClose} role="presentation">
      <div
        className="confirm-modal payment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 id="payment-dialog-title" className="confirm-title">
            {t('Thanh toán đợt {n}', { n: index + 1 })}
          </h3>
          <p className="confirm-message">
            {formatDate(batch.date)} · {formatVND(batch.cost)}
          </p>
        </div>
        <Calendar value={draft} onChange={setDraft} max={todayVN()} />
        <div className="confirm-actions">
          {batch.paidOn && (
            <button type="button" className="payment-unmark" disabled={saving} onClick={() => save(null)}>
              {t('Bỏ đánh dấu')}
            </button>
          )}
          <button type="button" className="confirm-btn-cancel" disabled={saving} onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || !draft || draft === batch.paidOn}
            onClick={() => save(draft)}
          >
            {batch.paidOn ? t('Lưu ngày') : t('Xác nhận')}
          </button>
        </div>
      </div>
    </div>
  )
}
