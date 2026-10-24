import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { addDays, errorMessage, formatDate, formatVND } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { readSheet } from '../lib/readSheet'
import { channelLabel } from '../lib/revenue'
import { parseInvoices, planInvoiceImport, type InvoiceRow, type ParsedInvoices } from '../lib/invoiceImport'
import type { DailyRevenue, RevenueInvoice } from '../types/database'
import { ImportDiffs } from './ImportDiffs'

type Loaded = { parsed: ParsedInvoices; existing: InvoiceRow[]; daily: Pick<DailyRevenue, 'revenue_date' | 'channel' | 'amount'>[]; fileName: string }

const CHUNK = 400

// Nhập file "Doanh thu theo danh sách hóa đơn" của máy POS. Hoá đơn trùng mã và giống hệt thì bỏ qua, hoá đơn mới thì thêm,
// hoá đơn đã có mà khác thì cảnh báo và chỉ ghi đè khi người dùng tích chọn.
export function ImportInvoices({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const reset = () => {
    setLoaded(null)
    setError(null)
    setOverwrite(false)
    setConfirm(false)
    if (input.current) input.current.value = ''
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const parsed = parseInvoices(await readSheet(file))
      const dates = parsed.invoices.map((i) => i.revenue_date).sort()
      const from = addDays(dates[0], -60)
      const to = addDays(dates[dates.length - 1], 60)
      const [existing, daily] = await Promise.all([
        fetchAll<RevenueInvoice>((a, b) =>
          supabase.from('revenue_invoices').select('*').eq('store_id', storeId).gte('revenue_date', from).lte('revenue_date', to).order('invoice_code').range(a, b),
        ),
        fetchAll<Pick<DailyRevenue, 'revenue_date' | 'channel' | 'amount'>>((a, b) =>
          supabase.from('daily_revenue').select('revenue_date, channel, amount').eq('store_id', storeId).gte('revenue_date', from).lte('revenue_date', to).order('revenue_date').range(a, b),
        ),
      ])
      setLoaded({ parsed, existing, daily, fileName: file.name })
      setOverwrite(false)
      setConfirm(false)
    } catch (e) {
      setLoaded(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const plan = loaded ? planInvoiceImport(loaded.parsed.invoices, loaded.existing, loaded.daily, overwrite) : null
  const risky = !!plan && plan.impacts.some((i) => i.kind === 'overwrite')
  const needConfirm = !!plan && (risky || (overwrite && plan.changed.length > 0))

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      let inserted = 0
      let updated = 0
      for (let i = 0; i < plan.toSend.length; i += CHUNK) {
        const { data, error: e } = await supabase.rpc('import_revenue_invoices', { p_store_id: storeId, p_rows: plan.toSend.slice(i, i + CHUNK) })
        if (e) throw e
        inserted += data.inserted
        updated += data.updated
      }
      toast.success(t('Đã nhập {added} hóa đơn mới, ghi đè {updated} hóa đơn', { added: inserted, updated }))
      reset()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card form import-box">
      <div className="row">
        <label className="import-file">
          {t('Nhập từ file hóa đơn POS (.xlsx)')}
          <input ref={input} type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {loaded && (
          <button type="button" onClick={reset} disabled={busy}>
            {t('Huỷ nhập')}
          </button>
        )}
      </div>
      <small className="muted">{t('Hóa đơn đã có và giống hệt sẽ được bỏ qua, chỉ thêm hóa đơn mới. Hóa đơn khác thông tin sẽ được báo trước khi ghi đè.')}</small>
      {error && <p className="error">{t(error)}</p>}
      {busy && !loaded && <p className="muted">{t('Đang đọc file…')}</p>}

      {loaded && plan && (
        <div className="import-preview">
          <p>
            <strong>{loaded.fileName}</strong>:{' '}
            {t('{total} hóa đơn trong file: {added} mới, {same} trùng (bỏ qua), {changed} khác thông tin', {
              total: loaded.parsed.invoices.length,
              added: plan.added.length,
              same: plan.identical,
              changed: plan.changed.length,
            })}
            {loaded.parsed.unsupported > 0 && ` · ${t('{count} hóa đơn trạng thái khác bị bỏ qua', { count: loaded.parsed.unsupported })}`}
          </p>

          {plan.changed.length > 0 && (
            <div className="import-warn">
              <p>
                <strong>{t('{count} hóa đơn đã có nhưng khác thông tin trong file:', { count: plan.changed.length })}</strong>
              </p>
              <ImportDiffs rows={plan.changed.map((c) => ({ id: c.row.invoice_code, title: c.row.invoice_code, diffs: c.diffs }))} />
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                {t('Ghi đè {count} hóa đơn này bằng số liệu trong file (mặc định giữ nguyên)', { count: plan.changed.length })}
              </label>
            </div>
          )}

          {plan.impacts.length > 0 && (
            <div className={risky ? 'import-warn' : undefined}>
              <p>
                <strong>{t('Doanh thu theo ngày sẽ đổi:')}</strong>
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Ngày')}</th>
                      <th>{t('Kênh')}</th>
                      <th className="num">{t('Hiện có')}</th>
                      <th className="num">{t('Sau khi nhập')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plan.impacts.map((i) => (
                      <tr key={`${i.date}|${i.channel}`}>
                        <td>{formatDate(i.date)}</td>
                        <td>{t(channelLabel(i.channel))}</td>
                        <td className="num">{i.before === null ? '—' : formatVND(i.before)}</td>
                        <td className="num">{formatVND(i.after)}</td>
                        <td>
                          {i.kind === 'overwrite' ? (
                            <span className="badge badge-out">{t('Sẽ bị đè')}</span>
                          ) : (
                            <span className="muted">{i.kind === 'new' ? t('Ngày mới') : t('Cập nhật')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {risky && <p className="muted">{t('Dòng "Sẽ bị đè": doanh thu đang lưu của ngày đó không khớp các hóa đơn đã có (có thể do nhập tay), nhập xong sẽ thay bằng tổng hóa đơn.')}</p>}
            </div>
          )}

          {needConfirm && (
            <label className="check">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              {t('Tôi đã xem cảnh báo và đồng ý ghi đè')}
            </label>
          )}
          {plan.toSend.length === 0 && <p className="muted">{t('Không có hóa đơn nào cần nhập.')}</p>}
          <div className="row">
            <button type="button" className="primary" disabled={busy || plan.toSend.length === 0 || (needConfirm && !confirm)} onClick={apply}>
              {busy ? t('Đang nhập…') : t('Nhập {count} hóa đơn', { count: plan.toSend.length })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
