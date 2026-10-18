import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, errorMessage, formatVND, notFuture, todayVN } from '../lib/format'
import type { Product, ProductPrice } from '../types/database'

type FormValues = { purchase_date: string; note: string }
// cost null = chưa sửa tay: gửi null để DB lấy giá vốn có hiệu lực vào ngày nhập
type Line = { product_id: string; qty: string; cost: string | null }

// Cửa hàng ít món thì mặc định nhập nhanh
const QUICK_MAX = 10

export function PurchasePage() {
  const { current } = useStore()
  return current ? <PurchaseForm key={current.id} storeId={current.id} /> : null
}

// Nhân viên cũng nhập được, nhưng không bao giờ xem được giá vốn: ô giá để trống
// thì DB dùng giá vốn hiện hành. Chỉ admin được điền sẵn giá vốn (đọc product_prices).
function PurchaseForm({ storeId }: { storeId: string }) {
  const { isAdmin } = useAuth()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [lines, setLines] = useState<Line[]>([])
  const [quickMode, setQuickMode] = useState<boolean | null>(null)
  const [costHistory, setCostHistory] = useState<ProductPrice[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { purchase_date: todayVN(), note: '' } })

  const purchaseDate = useWatch({ control, name: 'purchase_date' })
  const stocked = products.filter((p) => p.tracks_stock)
  const stockedKey = stocked.map((p) => p.id).join(',')
  const quick = quickMode ?? stocked.length <= QUICK_MAX
  const byId = new Map(stocked.map((p) => [p.id, p]))

  useEffect(() => {
    if (!isAdmin || stockedKey === '') return
    let cancelled = false
    supabase
      .from('product_prices')
      .select('*')
      .in('product_id', stockedKey.split(','))
      .order('effective_from', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setCostHistory(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, stockedKey])

  // Giá vốn có hiệu lực vào ngày nhập (lịch sử đã sắp mới nhất trước). Nhân viên: luôn trống.
  const currentCost = (id: string): number | null =>
    costHistory.find((r) => r.product_id === id && r.effective_from <= purchaseDate)?.unit_cost ??
    null
  const costText = (line: Line) => {
    if (line.cost !== null) return line.cost
    const cost = currentCost(line.product_id)
    return cost === null ? '' : String(cost)
  }
  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(costText(l)) || 0), 0)
  const hasBlankCost = lines.some((l) => costText(l) === '')

  const onPick = (ids: string[]) => {
    setLines((ls) => [
      ...ls.filter((l) => ids.includes(l.product_id)),
      ...ids
        .filter((id) => !ls.some((l) => l.product_id === id))
        .map((id) => ({ product_id: id, qty: '1', cost: null })),
    ])
  }

  // Nhập nhanh: ô trống hoặc 0 thì bỏ món; chọn món: giữ dòng, chỉ đổi số
  const setQty = (id: string, qty: string) => {
    setLines((ls) => {
      if (quick && (Number(qty) || 0) <= 0) return ls.filter((l) => l.product_id !== id)
      if (ls.some((l) => l.product_id === id)) {
        return ls.map((l) => (l.product_id === id ? { ...l, qty } : l))
      }
      return [...ls, { product_id: id, qty, cost: null }]
    })
  }

  const setCost = (id: string, cost: string) => {
    setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, cost } : l)))
  }

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id))

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    setFormError(null)
    if (lines.length === 0) return setFormError('Đợt nhập phải có ít nhất một sản phẩm')
    const items = []
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(`Số lượng của "${name}" phải là số nguyên > 0`)
      }
      if (quantity > MAX_QTY) return setFormError(`Số lượng của "${name}" quá lớn, kiểm tra lại`)
      // Admin thấy được giá vốn nên báo sớm món chưa có giá vốn mà ô giá để trống
      if (isAdmin && costText(line) === '') {
        return setFormError(`"${name}" chưa có giá vốn: nhập giá nhập cho món này`)
      }
      // Chỉ gửi giá khi người dùng tự gõ; còn lại để DB lấy giá vốn hiện hành
      const typed = line.cost?.trim() ?? ''
      const unitCost = typed === '' ? null : Number(typed)
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        return setFormError(`Giá nhập của "${name}" không hợp lệ`)
      }
      if (unitCost !== null && unitCost > MAX_MONEY) {
        return setFormError(`Giá nhập của "${name}" quá lớn, kiểm tra lại`)
      }
      items.push({ product_id: line.product_id, quantity, unit_cost: unitCost })
    }

    const { error } = await supabase.rpc('create_purchase', {
      p_store_id: storeId,
      p_purchase_date: values.purchase_date || null,
      p_note: values.note.trim() || null,
      p_items: items,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    setResult({ ok: true, text: `Đã lưu đợt nhập ${lines.length} món` })
    reset({ purchase_date: values.purchase_date, note: '' })
    setLines([])
    reload()
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  const info = (p: Product) => `Ở nhà: ${stock.get(p.id)?.qty_home ?? 0}`
  const lineFor = (id: string) => lines.find((l) => l.product_id === id)

  const costInput = (line: Line, name: string) => (
    <input
      type="text"
      inputMode="numeric"
      className="price-input"
      placeholder="Giá hiện hành"
      aria-label={`Giá nhập ${name}`}
      value={costText(line)}
      onChange={(e) => setCost(line.product_id, e.target.value.replace(/[^0-9.]/g, ''))}
    />
  )

  const submitLabel = isSubmitting ? 'Đang lưu…' : 'Lưu đợt nhập'
  const canSubmit = !isSubmitting && lines.length > 0

  return (
    <section>
      <h2>Nhập hàng</h2>
      <form className="pos" onSubmit={handleSubmit(onSubmit)}>
        <div className="pos-main card">
          <label className="field">
            Ngày nhập
            <input
              type="date"
              max={todayVN()}
              {...register('purchase_date', { required: 'Chọn ngày nhập', validate: notFuture })}
            />
          </label>
          {errors.purchase_date && <p className="error">{errors.purchase_date.message}</p>}

          {stocked.length === 0 ? (
            <p className="pos-empty muted">Cửa hàng chưa có món nào đếm tồn kho.</p>
          ) : (
            <ProductPicker
              products={stocked}
              selectedIds={lines.map((l) => l.product_id)}
              onChange={onPick}
              renderInfo={info}
              quick={quick}
              onQuickChange={setQuickMode}
              renderQuick={(p) => {
                const line = lineFor(p.id)
                return (
                  <div className="quick-inputs">
                    {line && costInput(line, p.name)}
                    <QtyStepper
                      value={line?.qty ?? ''}
                      onChange={(v) => setQty(p.id, v)}
                      min={0}
                      label={`số lượng ${p.name}`}
                    />
                  </div>
                )
              }}
            />
          )}
        </div>

        <aside className="pos-side card">
          <div className="pos-side-head">
            <h3>Đợt nhập</h3>
            <span className="count-pill">{lines.length} món</span>
          </div>

          {lines.length === 0 ? (
            <p className="pos-empty muted">
              {quick ? 'Nhập số lượng ở danh sách món bên cạnh.' : 'Chạm vào món ở bên cạnh để thêm vào đợt nhập.'}
            </p>
          ) : (
            <div className="order-lines">
              {lines.map((line) => {
                const name = byId.get(line.product_id)?.name ?? ''
                const cost = Number(costText(line))
                return (
                  <div key={line.product_id} className="order-line">
                    <div className="order-line-top">
                      <span className="order-line-name">{name}</span>
                      <button
                        type="button"
                        className="remove"
                        aria-label={`Xoá ${name}`}
                        onClick={() => removeLine(line.product_id)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="order-line-bottom">
                      <QtyStepper
                        value={line.qty}
                        onChange={(v) => setQty(line.product_id, v)}
                        min={1}
                        label={`số lượng ${name}`}
                      />
                      <span className="times">×</span>
                      {costInput(line, name)}
                      <span className="subtotal">
                        {costText(line) === '' ? '—' : formatVND((Number(line.qty) || 0) * (cost || 0))}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <small className="muted">Ô giá nhập để trống thì dùng giá vốn hiện hành của món.</small>

          <label className="field">
            Ghi chú
            <input type="text" placeholder="Không bắt buộc" {...register('note')} />
          </label>

          <div className="pos-total">
            <span>Tổng tiền nhập{hasBlankCost && <small> (chưa gồm món để trống giá)</small>}</span>
            <strong>{formatVND(total)}</strong>
          </div>

          {formError && <p className="error">{formError}</p>}
          {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
          <button type="submit" className="primary block" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </aside>

        <div className="pos-mobilebar">
          <div>
            <small>{lines.length} món</small>
            <strong>{formatVND(total)}</strong>
          </div>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </section>
  )
}
