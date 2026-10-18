import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { errorMessage, formatVND, todayVN } from '../lib/format'
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
    formState: { isSubmitting },
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
      // Chỉ gửi giá khi người dùng tự gõ; còn lại để DB lấy giá vốn hiện hành
      const typed = line.cost?.trim() ?? ''
      const unitCost = typed === '' ? null : Number(typed)
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        return setFormError(`Giá nhập của "${name}" không hợp lệ`)
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

  return (
    <section>
      <h2>Nhập hàng</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <label>
          Ngày nhập
          <input type="date" {...register('purchase_date', { required: true })} />
        </label>

        {stocked.length === 0 ? (
          <p className="muted">Cửa hàng chưa có món nào đếm tồn kho.</p>
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
                  <QtyStepper
                    value={line?.qty ?? ''}
                    onChange={(v) => setQty(p.id, v)}
                    min={0}
                    label={`số lượng ${p.name}`}
                  />
                  {line && costInput(line, p.name)}
                </div>
              )
            }}
          />
        )}

        {!quick && lines.length > 0 && (
          <div className="picked">
            <h3>Món đã chọn ({lines.length})</h3>
            {lines.map((line) => {
              const name = byId.get(line.product_id)?.name ?? ''
              return (
                <div key={line.product_id} className="picked-row">
                  <div className="picker-name">{name}</div>
                  <QtyStepper
                    value={line.qty}
                    onChange={(v) => setQty(line.product_id, v)}
                    min={1}
                    label={`số lượng ${name}`}
                  />
                  {costInput(line, name)}
                  <button type="button" className="link" onClick={() => removeLine(line.product_id)}>
                    Xoá
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <small className="muted">Ô giá nhập để trống thì dùng giá vốn hiện hành của món.</small>

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        <p className="total">
          {lines.length} món · Tổng tiền nhập: <strong>{formatVND(total)}</strong>
          {hasBlankCost && <small className="muted"> (chưa gồm món để trống giá)</small>}
        </p>

        {formError && <p className="error">{formError}</p>}
        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Lưu đợt nhập'}
        </button>
      </form>
    </section>
  )
}
