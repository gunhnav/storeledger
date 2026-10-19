import { useState } from 'react'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { evalExpression, isExpression } from '../lib/calc'
import { storedUnitPrice } from '../lib/expenses'

// Nhóm chi phí của khoản chi sinh từ nhập kho
const PURCHASE_EXPENSE_CATEGORY = 'Đồ uống'

type Row = { id: number; productId: string; qty: string; unitPrice: string; total: string }

const cleanNumber = (text: string) => text.replace(/[^0-9]/g, '')
const cleanExpression = (text: string) => text.replace(/[^0-9.,+\-*/x×÷:()kKtTrR\s]/g, '')
const num = (text: string) => (text.trim() === '' ? Number.NaN : (evalExpression(text) ?? Number.NaN))
let nextId = 1
const newRow = (): Row => ({ id: nextId++, productId: '', qty: '', unitPrice: '', total: '' })
const isBlank = (r: Row) => r.productId === '' && r.qty.trim() === '' && r.unitPrice.trim() === '' && r.total.trim() === ''

// Nhập kho dạng bảng giống Chi phí. Lưu xong: tạo đợt nhập (tồn kho), đưa hàng ra quán và ghi vào Chi phí.
// Nhân viên chỉ nhập món + số lượng (không thấy giá, DB dùng giá vốn hiện hành).
export function PurchaseRowsForm({ storeId, autoToShop }: { storeId: string; autoToShop: boolean }) {
  const { t } = useI18n()
  const toast = useToast()
  const { isAdmin } = useAuth()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [date, setDate] = useState(todayVN())
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const stocked = products.filter((p) => p.tracks_stock)
  const byId = new Map(stocked.map((p) => [p.id, p]))
  const update = (id: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)))
  const addRow = () => setRows((rs) => [...rs, newRow()])
  const removeRow = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs))

  // Thành tiền của dòng: ghi đè nếu có, không thì số lượng × đơn giá
  const lineTotal = (r: Row) => {
    if (r.total.trim() !== '') return num(r.total)
    return (Number(r.qty) || 0) * (num(r.unitPrice) || 0)
  }
  const filled = rows.filter((r) => !isBlank(r))
  const total = filled.reduce((s, r) => s + (Number.isFinite(lineTotal(r)) ? lineTotal(r) : 0), 0)

  const save = async () => {
    setResult(null)
    const dateError = notFuture(date)
    if (dateError !== true) return setResult({ ok: false, text: dateError })
    if (filled.length === 0) return setResult({ ok: false, text: 'Đợt nhập phải có ít nhất một sản phẩm' })
    const items: { product_id: string; quantity: number; unit_cost: number | null }[] = []
    for (const r of filled) {
      const n = rows.indexOf(r) + 1
      const fail = (text: string) => setResult({ ok: false, text: t('Dòng {n}: {error}', { n, error: t(text) }) })
      if (r.productId === '') return fail('Chọn món')
      const quantity = Number(r.qty)
      if (!Number.isInteger(quantity) || quantity <= 0) return fail('Số lượng phải là số nguyên > 0')
      if (quantity > MAX_QTY) return fail('Số lượng quá lớn, kiểm tra lại')
      let unitCost: number | null = null
      if (isAdmin) {
        if (r.total.trim() !== '') {
          const amount = num(r.total)
          if (!Number.isFinite(amount) || amount <= 0) return fail('Phép tính ở ô Thành tiền không hợp lệ')
          unitCost = storedUnitPrice(amount / quantity)
        } else if (r.unitPrice.trim() !== '') {
          const price = num(r.unitPrice)
          if (!Number.isFinite(price) || price < 0) return fail('Phép tính ở ô Đơn giá không hợp lệ')
          unitCost = storedUnitPrice(price)
        }
        if (unitCost !== null && quantity * unitCost > MAX_MONEY) return fail('Số tiền quá lớn, kiểm tra lại')
      }
      items.push({ product_id: r.productId, quantity, unit_cost: unitCost })
    }

    setSaving(true)
    const finish = (text: string) => {
      setSaving(false)
      setResult({ ok: false, text })
      reload()
    }
    const { data: purchaseId, error: purchaseError } = await supabase.rpc('create_purchase', {
      p_store_id: storeId,
      p_purchase_date: date,
      p_note: note.trim() || null,
      p_items: items,
    })
    if (purchaseError || !purchaseId) return finish(purchaseError ? errorMessage(purchaseError) : 'Không tạo được đợt nhập')

    const { error: expenseError } = await supabase.rpc('record_purchase_expenses', {
      p_purchase_id: purchaseId,
      p_category: PURCHASE_EXPENSE_CATEGORY,
    })
    if (expenseError) return finish(t('Đã nhập hàng nhưng chưa ghi được vào Chi phí: {error}', { error: t(errorMessage(expenseError)) }))

    // Quán không có bước Phân phối: chuyển ngay toàn bộ hàng vừa nhập ra quán (cùng ngày nhập)
    if (autoToShop) {
      const failed: string[] = []
      for (const item of items) {
        const { error: moveError } = await supabase.rpc('create_transfer', {
          p_store_id: storeId,
          p_product_id: item.product_id,
          p_quantity: item.quantity,
          p_transfer_date: date,
          p_note: 'Tự vào quán khi nhập hàng',
          p_destination: 'shop',
        })
        if (moveError) failed.push(`${byId.get(item.product_id)?.name ?? ''}: ${t(errorMessage(moveError))}`)
      }
      if (failed.length > 0) return finish(t('Đã nhập hàng nhưng chưa đưa vào quán được: {list}', { list: failed.join('; ') }))
    }

    setSaving(false)
    toast.success(t('Đã lưu đợt nhập {count} món ngày {date}', { count: items.length, date: formatDate(date) }))
    setRows([newRow()])
    setNote('')
    reload()
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  return (
    <section>
      <div className="card form">
        <div className="field expense-date">
          {t('Ngày nhập')}
          <DatePicker value={date} onChange={setDate} max={todayVN()} label={t('Ngày nhập')} />
        </div>

        {stocked.length === 0 ? (
          <p className="muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>
        ) : (
          <div className="expense-lines">
            <div className={`expense-line purchase-line${isAdmin ? '' : ' no-price'} expense-line-head`} aria-hidden="true">
              <span>{t('Món')}</span>
              <span>{t('Số lượng')}</span>
              {isAdmin && <span>{t('Đơn giá')}</span>}
              {isAdmin && <span>{t('Thành tiền')}</span>}
              <span />
            </div>
            {rows.map((r, i) => {
              const line = lineTotal(r)
              return (
                <div key={r.id} className={`expense-line purchase-line${isAdmin ? '' : ' no-price'}`}>
                  <label>
                    <span className="mobile-label">{t('Món')}</span>
                    <select value={r.productId} onChange={(e) => update(r.id, { productId: e.target.value })} aria-label={t('Món')}>
                      <option value="">{t('Chọn món')}</option>
                      {stocked.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({t('Ở quán: {value}', { value: stock.get(p.id)?.qty_shop ?? 0 })})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mobile-label">{t('Số lượng')}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={t('Số lượng')}
                      value={r.qty}
                      onChange={(e) => update(r.id, { qty: cleanNumber(e.target.value) })}
                    />
                  </label>
                  {isAdmin && (
                    <label>
                      <span className="mobile-label">{t('Đơn giá')}</span>
                      <input
                        type="text"
                        aria-label={t('Đơn giá')}
                        placeholder={t('Giá vốn hiện hành')}
                        value={r.unitPrice}
                        onChange={(e) => update(r.id, { unitPrice: cleanExpression(e.target.value) })}
                      />
                    </label>
                  )}
                  {isAdmin && (
                    <label>
                      <span className="mobile-label">{t('Thành tiền')}</span>
                      <span className="input-action">
                        <input
                          type="text"
                          aria-label={t('Thành tiền')}
                          className={r.total.trim() !== '' ? 'overridden' : undefined}
                          placeholder={Number.isFinite(line) && line > 0 ? formatVND(line) : t('Số hoặc phép tính')}
                          value={r.total}
                          onChange={(e) => update(r.id, { total: cleanExpression(e.target.value) })}
                          onKeyDown={(e) => {
                            // Enter ở ô cuối của dòng cuối: thêm dòng mới
                            if (e.key === 'Enter' && i === rows.length - 1) {
                              e.preventDefault()
                              addRow()
                            }
                          }}
                        />
                        {isExpression(r.total) && Number.isFinite(line) && <small className="calc-result">= {formatVND(line)}</small>}
                      </span>
                    </label>
                  )}
                  {rows.length > 1 ? (
                    <button type="button" className="remove" aria-label={t('Xoá dòng {n}', { n: i + 1 })} onClick={() => removeRow(r.id)}>
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              )
            })}
          </div>
        )}

        <button type="button" className="expense-add" onClick={addRow}>
          + {t('Thêm dòng')}
        </button>
        <small className="muted">
          {isAdmin
            ? t('Để trống đơn giá và thành tiền thì dùng giá vốn đang áp dụng vào ngày nhập. Lưu xong, tiền nhập tự ghi vào Chi phí (nhóm Đồ uống).')
            : t('Chọn món và số lượng, giá nhập do hệ thống tự lấy.')}
        </small>

        <label className="field">
          {t('Ghi chú')}
          <input type="text" placeholder={t('Không bắt buộc')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="expense-footer">
          <span>
            {t('{count} món', { count: filled.length })}
            {isAdmin && (
              <>
                {' · '}
                <strong>{formatVND(total)}</strong>
              </>
            )}
          </span>
          <button type="button" className="primary" disabled={saving || filled.length === 0} onClick={save}>
            {saving ? t('Đang lưu…') : t('Lưu đợt nhập')}
          </button>
        </div>
        {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
      </div>
    </section>
  )
}
