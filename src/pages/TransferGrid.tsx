import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { addDays, errorMessage, formatDate, todayVN } from '../lib/format'
import {
  cellKey,
  gridDates,
  movedByCell,
  overHome,
  parseEntries,
  splitKey,
  totalsByProduct,
  type CellError,
} from '../lib/transferGrid'

const DAYS = 7
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
const dayMonth = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

const REASONS: Record<CellError['reason'], string> = {
  not_integer: 'Số lượng phải là số nguyên > 0',
  too_large: 'Số lượng quá lớn, kiểm tra lại',
  future: 'Không chọn ngày trong tương lai',
}

// Nhập "Mang ra quán" như bảng Excel: cột là ngày, hàng là món đếm tồn, ô là số hũ mang thêm ra quầy.
// Mỗi ô lưu bằng create_transfer có sẵn (FIFO theo lô, chặn vượt tồn ở nhà / ngày tương lai / lô nhập sau ngày chuyển).
export function TransferGrid({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const today = todayVN()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [end, setEnd] = useState(today)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState(0)
  const [moved, setMoved] = useState<{ key: string; map: Map<string, number>; error: string | null } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const dates = gridDates(end, DAYS)
  const from = dates[0]
  const movedKey = `${from}|${end}|${version}`

  useEffect(() => {
    let cancelled = false
    supabase
      .from('stock_transfers')
      .select('product_id, quantity, transfer_date')
      .eq('store_id', storeId)
      .gte('transfer_date', from)
      .lte('transfer_date', end)
      .then(({ data, error }) => {
        if (cancelled) return
        const map = movedByCell((data ?? []).map((r) => ({ productId: r.product_id, date: r.transfer_date, qty: r.quantity })))
        setMoved({ key: movedKey, map, error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, from, end, movedKey])

  // Điện thoại: cuộn để cột hôm nay hiện ra
  useEffect(() => {
    const wrap = wrapRef.current
    const th = wrap?.querySelector<HTMLElement>('th.today-col')
    if (wrap && th) wrap.scrollLeft = Math.max(0, th.offsetLeft - wrap.clientWidth / 2 + th.offsetWidth / 2)
  }, [loading, end])

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const stocked = products.filter((p) => p.tracks_stock)
  const names = new Map(stocked.map((p) => [p.id, p.name]))
  const home = new Map(stocked.map((p) => [p.id, stock.get(p.id)?.qty_home ?? 0]))
  const { entries, errors } = parseEntries(inputs, today)
  const errorAt = new Map(errors.map((e) => [e.key, t(REASONS[e.reason])]))
  const over = overHome(entries, home)
  const overIds = new Set(over.map((o) => o.productId))
  const wanted = totalsByProduct(entries)
  const movedMap = moved?.key === movedKey ? moved.map : null
  const canSave = !saving && entries.length > 0 && errors.length === 0 && over.length === 0

  const setCell = (key: string, value: string) => {
    setInputs((s) => ({ ...s, [key]: value }))
    setServerErrors((s) => {
      if (!(key in s)) return s
      const next = { ...s }
      delete next[key]
      return next
    })
  }

  // Phím như Excel: Enter / ↓ xuống hàng, ↑ lên hàng, ← → sang cột khi con trỏ ở mép ô
  const onKey = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const input = e.currentTarget
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0
    const atEnd = input.selectionStart === input.value.length
    const move: Record<string, [number, number] | null> = {
      Enter: [row + 1, col],
      ArrowDown: [row + 1, col],
      ArrowUp: [row - 1, col],
      ArrowLeft: atStart ? [row, col - 1] : null,
      ArrowRight: atEnd ? [row, col + 1] : null,
    }
    const target = move[e.key]
    if (!target) return
    const next = wrapRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${target[0]}-${target[1]}"]`)
    if (!next) return
    e.preventDefault()
    next.focus()
    next.select()
  }

  const save = async () => {
    setSaving(true)
    const failed: Record<string, string> = {}
    const done: string[] = []
    for (const entry of entries) {
      const { error } = await supabase.rpc('create_transfer', {
        p_store_id: storeId,
        p_product_id: entry.productId,
        p_quantity: entry.qty,
        p_transfer_date: entry.date,
        p_note: null,
      })
      if (error) failed[cellKey(entry.productId, entry.date)] = errorMessage(error)
      else done.push(cellKey(entry.productId, entry.date))
    }
    setSaving(false)
    setInputs((s) => {
      const next = { ...s }
      for (const key of done) delete next[key]
      return next
    })
    setServerErrors(failed)
    reload()
    setVersion((v) => v + 1)
    const failedCount = Object.keys(failed).length
    if (failedCount === 0) toast.success(t('Đã lưu {count} ô mang ra quán', { count: done.length }))
    else if (done.length > 0) toast.success(t('Đã lưu {count} ô; {failed} ô lỗi còn giữ lại để sửa', { count: done.length, failed: failedCount }))
  }

  const problems = [
    ...errors.map((e) => ({ key: e.key, text: t(REASONS[e.reason]) })),
    ...Object.entries(serverErrors).map(([key, text]) => ({ key, text: t(text) })),
  ]
  const pendingOutside = entries.filter((e) => e.date < from || e.date > end).length

  return (
    <section className="transfer-grid">
      <p className="muted">
        {t('Gõ số hũ mang từ nhà ra quán vào ô của từng ngày, rồi bấm Lưu. Số nhỏ phía trên ô là số đã mang ra trước đó.')}
      </p>

      <div className="row grid-nav">
        <button type="button" onClick={() => setEnd(addDays(end, -DAYS))}>
          ← {t('{count} ngày trước', { count: DAYS })}
        </button>
        <button type="button" onClick={() => setEnd(today)} disabled={end === today}>
          {t('Hôm nay')}
        </button>
        <button type="button" onClick={() => setEnd(addDays(end, DAYS) > today ? today : addDays(end, DAYS))} disabled={end === today}>
          {t('{count} ngày sau', { count: DAYS })} →
        </button>
        <span className="muted">
          {formatDate(from)} – {formatDate(end)}
        </span>
      </div>

      {stocked.length === 0 ? (
        <p className="pos-empty muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>
      ) : (
        <div className="table-wrap log-wrap" ref={wrapRef}>
          <table className="log-table grid-table">
            <thead>
              <tr>
                <th className="sticky-col">{t('Món')}</th>
                <th className="num">{t('Ở nhà')}</th>
                {dates.map((d) => (
                  <th key={d} className={`num${weekday(d) === 'CN' ? ' sunday' : ''}${d === today ? ' today-col' : ''}`}>
                    <span className="day-label">{dayMonth(d)}</span>
                    <span className="weekday">{d === today ? t('Hôm nay') : t(weekday(d))}</span>
                  </th>
                ))}
                <th className="num total-col">{t('Mang thêm')}</th>
              </tr>
            </thead>
            <tbody>
              {stocked.map((p, row) => {
                const want = wanted.get(p.id) ?? 0
                const isOver = overIds.has(p.id)
                return (
                  <tr key={p.id} className={isOver ? 'grid-over' : undefined}>
                    <td className="sticky-col">
                      {p.name}
                      {isOver && <small className="warn">{t('Vượt số ở nhà (còn {home})', { home: home.get(p.id) ?? 0 })}</small>}
                    </td>
                    <td className="num">{home.get(p.id) ?? 0}</td>
                    {dates.map((d, col) => {
                      const key = cellKey(p.id, d)
                      const already = movedMap?.get(key) ?? 0
                      const problem = errorAt.get(key) ?? serverErrors[key]
                      return (
                        <td key={d} className={`num grid-cell${d === today ? ' today-col' : ''}`}>
                          <span className="grid-moved">{already > 0 ? t('đã mang {count}', { count: already }) : ' '}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            data-cell={`${row}-${col}`}
                            value={inputs[key] ?? ''}
                            onChange={(e) => setCell(key, e.target.value)}
                            onKeyDown={(e) => onKey(e, row, col)}
                            onFocus={(e) => e.target.select()}
                            aria-label={t('Mang ra quán {name} ngày {date}', { name: p.name, date: formatDate(d) })}
                            aria-invalid={problem ? true : undefined}
                            title={problem ? t(problem) : undefined}
                          />
                        </td>
                      )
                    })}
                    <td className="num total-col">{want > 0 ? want : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {moved?.error && <p className="error">{t(moved.error)}</p>}
      {problems.length > 0 && (
        <ul className="error grid-problems">
          {problems.map((p) => {
            const { productId, date } = splitKey(p.key)
            return (
              <li key={p.key}>
                {names.get(productId)} – {formatDate(date)}: {p.text}
              </li>
            )
          })}
        </ul>
      )}

      <div className="row grid-actions">
        <button type="button" className="primary" disabled={!canSave} onClick={save}>
          {saving ? t('Đang lưu…') : t('Lưu {count} ô', { count: entries.length })}
        </button>
        {pendingOutside > 0 && (
          <span className="muted">{t('Có {count} ô đã gõ ở tuần khác, cũng sẽ được lưu.', { count: pendingOutside })}</span>
        )}
      </div>
    </section>
  )
}
