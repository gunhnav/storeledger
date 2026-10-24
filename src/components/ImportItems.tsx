import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorMessage, formatDate } from '../lib/format'
import { fetchAll } from '../lib/fetchAll'
import { readSheet } from '../lib/readSheet'
import { HIDDEN_CATEGORIES, reconcile } from '../lib/itemSales'
import { parseItemReport, planItemImport, type ItemRow, type ParsedItems } from '../lib/itemImport'
import type { MonthlyItemSale } from '../types/database'
import { ImportDiffs } from './ImportDiffs'
import { Mismatches } from '../pages/ItemSalesPage'

type Loaded = { parsed: ParsedItems; existing: MonthlyItemSale[]; revenue: Map<string, number>; fileName: string }

const CHUNK = 300

// Nhập file "Báo cáo mặt hàng" (một tháng) của máy POS. Mặt hàng trùng mã trong tháng và giống hệt thì bỏ qua,
// mặt hàng mới thì thêm, mặt hàng đã có mà số liệu khác thì cảnh báo và chỉ ghi đè khi người dùng tích chọn.
export function ImportItems({ storeId, onDone }: { storeId: string; onDone: () => void }) {
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
      const parsed = parseItemReport(await readSheet(file))
      const { data, error: e } = await supabase.from('monthly_item_sales').select('*').eq('store_id', storeId).eq('period_start', parsed.periodStart).limit(5000)
      if (e) throw e
      const daily = await fetchAll<{ revenue_date: string; amount: number }>((a, b) =>
        supabase.from('daily_revenue').select('revenue_date, amount').eq('store_id', storeId).neq('channel', 'nem_cuon').gte('revenue_date', parsed.periodStart).lte('revenue_date', parsed.periodEnd).order('revenue_date').order('channel').range(a, b),
      )
      const revenue = new Map<string, number>()
      for (const d of daily) revenue.set(d.revenue_date, (revenue.get(d.revenue_date) ?? 0) + Number(d.amount))
      setLoaded({ parsed, existing: data, revenue, fileName: file.name })
      setOverwrite(false)
      setConfirm(false)
    } catch (e) {
      setLoaded(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const plan = loaded ? planItemImport(loaded.parsed.items, loaded.existing as ItemRow[], overwrite) : null
  const needConfirm = !!plan && overwrite && plan.changed.length > 0
  // Doanh thu cùng khoảng ngày phải bằng tổng mặt hàng trong file (mọi nhóm)
  const mismatches = loaded
    ? reconcile(loaded.parsed.items.map((i) => ({ period_start: loaded.parsed.periodStart, period_end: loaded.parsed.periodEnd, net: i.net })), loaded.revenue)
    : []
  const storedEnd = loaded?.existing.map((r) => r.period_end).sort().pop()

  const apply = async () => {
    if (!plan || !loaded) return
    setBusy(true)
    setError(null)
    try {
      const rows = plan.toSend.map((r) => ({ ...r, store_id: storeId, month: loaded.parsed.month, period_start: loaded.parsed.periodStart, period_end: loaded.parsed.periodEnd }))
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: e } = await supabase.from('monthly_item_sales').upsert(rows.slice(i, i + CHUNK), { onConflict: 'store_id,period_start,item_code' })
        if (e) throw e
      }
      toast.success(t('Đã nhập {added} mặt hàng mới, ghi đè {updated} mặt hàng', { added: plan.added.length, updated: overwrite ? plan.changed.length : 0 }))
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
          {t('Nhập từ file báo cáo mặt hàng POS (.xls, .xlsx)')}
          <input ref={input} type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {loaded && (
          <button type="button" onClick={reset} disabled={busy}>
            {t('Huỷ nhập')}
          </button>
        )}
      </div>
      <small className="muted">{t('Mặt hàng đã có trong tháng và giống hệt sẽ được bỏ qua, chỉ thêm mặt hàng mới. Mặt hàng khác số liệu sẽ được báo trước khi ghi đè.')}</small>
      {error && <p className="error">{t(error)}</p>}
      {busy && !loaded && <p className="muted">{t('Đang đọc file…')}</p>}

      {loaded && plan && (
        <div className="import-preview">
          <p>
            <strong>{loaded.fileName}</strong>:{' '}
            {t('Từ {from} đến hết {to}: {added} mặt hàng mới, {same} trùng (bỏ qua), {changed} khác số liệu', {
              from: formatDate(loaded.parsed.periodStart),
              to: formatDate(loaded.parsed.periodEnd),
              added: plan.added.length,
              same: plan.identical,
              changed: plan.changed.length,
            })}
          </p>
          {loaded.parsed.hidden > 0 && (
            <p className="muted">{t('{count} mặt hàng thuộc nhóm {groups} được lưu để đối chiếu doanh thu nhưng không hiện ở danh sách mặt hàng.', { count: loaded.parsed.hidden, groups: HIDDEN_CATEGORIES.join(', ') })}</p>
          )}
          {storedEnd && storedEnd !== loaded.parsed.periodEnd && (
            <p className="muted">{t('Dữ liệu đang lưu tính đến {stored}, file tính đến {file}.', { stored: formatDate(storedEnd), file: formatDate(loaded.parsed.periodEnd) })}</p>
          )}

          <Mismatches items={mismatches} />

          {plan.changed.length > 0 && (
            <div className="import-warn">
              <p>
                <strong>{t('{count} mặt hàng đã có nhưng khác số liệu trong file:', { count: plan.changed.length })}</strong>
              </p>
              <ImportDiffs rows={plan.changed.map((c) => ({ id: c.row.item_code, title: `${c.row.item_name} (${c.row.item_code})`, diffs: c.diffs }))} />
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                {t('Ghi đè {count} mặt hàng này bằng số liệu trong file (mặc định giữ nguyên)', { count: plan.changed.length })}
              </label>
            </div>
          )}

          {needConfirm && (
            <label className="check">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              {t('Tôi đã xem cảnh báo và đồng ý ghi đè')}
            </label>
          )}
          {plan.toSend.length === 0 && <p className="muted">{t('Không có mặt hàng nào cần nhập.')}</p>}
          <div className="row">
            <button type="button" className="primary" disabled={busy || plan.toSend.length === 0 || (needConfirm && !confirm)} onClick={apply}>
              {busy ? t('Đang nhập…') : t('Nhập {count} mặt hàng', { count: plan.toSend.length })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
