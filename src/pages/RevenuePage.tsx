import { useEffect, useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { ImportInvoices } from '../components/ImportInvoices'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { useAuth } from '../lib/auth'
import { MAX_MONEY, capitalizeFirst, errorMessage, formatDate, formatVND, monthStart, notFuture, todayVN } from '../lib/format'
import { evalExpression, isExpression } from '../lib/calc'
import { REVENUE_CHANNELS, channelLabel, commissionOf, type RevenueChannel } from '../lib/revenue'
import type { DailyRevenue } from '../types/database'

// Ô tiền: cho gõ số và phép tính (+ − × ÷, ngoặc, k / tr)
const cleanExpression = (text: string) => text.replace(/[^0-9.,+\-*/x×÷:()kKtTrR\s]/g, '')

// Nhập doanh thu theo ngày cho quán Bún đậu (thay cho màn hình bán theo món). Chỉ admin; RLS cũng chặn người khác.
// Mỗi (ngày, kênh) một dòng: nhập lại cùng ngày + kênh thì ghi đè.
export function RevenuePage() {
  const { current } = useStore()
  const { isAdmin } = useAuth()
  const { t } = useI18n()
  if (!current) return null
  if (!isAdmin) return <p className="muted">{t('Chỉ quản trị viên nhập được doanh thu.')}</p>
  return <RevenueForm key={current.id} storeId={current.id} rate={current.default_commission_rate} />
}

function RevenueForm({ storeId, rate }: { storeId: string; rate: number }) {
  const { t } = useI18n()
  const toast = useToast()
  const [date, setDate] = useState(todayVN())
  const [channel, setChannel] = useState<RevenueChannel>('in_store')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [recent, setRecent] = useState<{ rows: DailyRevenue[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('daily_revenue')
      .select('*')
      .eq('store_id', storeId)
      .order('revenue_date', { ascending: false })
      .order('channel')
      .limit(60)
      .then(({ data, error }) => {
        if (!cancelled) setRecent({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  const amount = amountText.trim() === '' ? Number.NaN : (evalExpression(amountText) ?? Number.NaN)
  const existing = recent?.rows.find((r) => r.revenue_date === date && r.channel === channel)
  const monthTotal = (recent?.rows ?? []).filter((r) => r.revenue_date >= monthStart(todayVN())).reduce((s, r) => s + Number(r.amount), 0)

  const save = async () => {
    setResult(null)
    const dateError = notFuture(date)
    if (dateError !== true) return setResult({ ok: false, text: dateError })
    if (!Number.isFinite(amount) || amount < 0) return setResult({ ok: false, text: 'Nhập số tiền hợp lệ' })
    if (amount > MAX_MONEY) return setResult({ ok: false, text: 'Số tiền quá lớn, kiểm tra lại' })
    setSaving(true)
    const { error } = await supabase.from('daily_revenue').upsert(
      { store_id: storeId, revenue_date: date, channel, amount, note: capitalizeFirst(note.trim()) || null },
      { onConflict: 'store_id,revenue_date,channel' },
    )
    setSaving(false)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã lưu doanh thu {amount} ngày {date}', { amount: formatVND(amount), date: formatDate(date) }))
    setAmountText('')
    setNote('')
    setVersion((v) => v + 1)
  }

  const startEdit = (row: DailyRevenue) => {
    setResult(null)
    setDate(row.revenue_date)
    setChannel(row.channel)
    setAmountText(String(Number(row.amount)))
    setNote(row.note ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (row: DailyRevenue) => {
    const label = `${formatDate(row.revenue_date)} · ${t(channelLabel(row.channel))} · ${formatVND(Number(row.amount))}`
    if (!window.confirm(t('Xoá doanh thu {label}? Không hoàn tác được.', { label }))) return
    setBusyId(row.id)
    const { error } = await supabase.from('daily_revenue').delete().eq('id', row.id)
    setBusyId(null)
    if (error) return setResult({ ok: false, text: errorMessage(error) })
    toast.success(t('Đã xoá doanh thu {label}', { label }))
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <ImportInvoices storeId={storeId} onDone={() => setVersion((v) => v + 1)} />
      <h2>{t('Nhập doanh thu')}</h2>
      <div className="card form">
        <div className="row">
          <div className="field">
            {t('Ngày')}
            <DatePicker value={date} onChange={setDate} label={t('Ngày')} />
          </div>
          <label>
            {t('Kênh')}
            <select value={channel} onChange={(e) => setChannel(e.target.value as RevenueChannel)}>
              {REVENUE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(channelLabel(c))}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Doanh thu trong ngày')}
            <input
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(cleanExpression(e.target.value))}
              placeholder={t('vd: 2.500.000 hoặc 1tr2+800k')}
            />
          </label>
        </div>
        {isExpression(amountText) && Number.isFinite(amount) && <small className="muted">= {formatVND(amount)}</small>}
        {channel === 'shopeefood' && Number.isFinite(amount) && amount > 0 && (
          <small className="muted">
            {t('Hoa hồng đối tác {fee} ({pct}%), thực thu {net}', {
              fee: formatVND(commissionOf(amount, channel, rate)),
              pct: Math.round(rate * 100),
              net: formatVND(amount - commissionOf(amount, channel, rate)),
            })}
          </small>
        )}
        <label>
          {t('Ghi chú')}
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Không bắt buộc')} />
        </label>
        {existing && (
          <small className="muted">
            {t('Ngày này kênh này đã có {amount}, lưu sẽ ghi đè.', { amount: formatVND(Number(existing.amount)) })}
          </small>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? t('Đang lưu…') : existing ? t('Cập nhật doanh thu') : t('Lưu doanh thu')}
          </button>
        </div>
        {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
      </div>

      <div className="section-head">
        <h2>{t('Doanh thu gần đây')}</h2>
        {recent && recent.rows.length > 0 && <span className="muted">{t('Tháng này: {amount}', { amount: formatVND(monthTotal) })}</span>}
      </div>
      {!recent ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : recent.error ? (
        <p className="error">{t(recent.error)}</p>
      ) : recent.rows.length === 0 ? (
        <p className="muted">{t('Chưa có doanh thu nào. Nhập ở form phía trên.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                <th>{t('Kênh')}</th>
                <th className="num">{t('Doanh thu')}</th>
                <th>{t('Ghi chú')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.revenue_date)}</td>
                  <td>{t(channelLabel(r.channel))}</td>
                  <td className="num">{formatVND(Number(r.amount))}</td>
                  <td>{r.note ?? ''}</td>
                  <td className="actions">
                    <button type="button" className="link" onClick={() => startEdit(r)}>
                      {t('Sửa')}
                    </button>
                    <button type="button" className="link danger" disabled={busyId === r.id} onClick={() => remove(r)}>
                      {t('Xoá')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
