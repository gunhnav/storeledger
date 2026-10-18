import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { useStoreCatalog, useStorePrices } from '../lib/useStoreCatalog'
import { errorMessage, formatVND, todayVN } from '../lib/format'
import type { Product, SaleChannel, StorePriceRow } from '../types/database'

type FormValues = { channel: SaleChannel; sale_date: string; note: string }
// price null = dùng giá gợi ý theo kênh và ngày bán
type Line = { product_id: string; qty: string; price: string | null }

// Cửa hàng ít món thì mặc định nhập nhanh
const QUICK_MAX = 10

// Giá gợi ý theo kênh, từ giá có hiệu lực vào ngày bán
function priceFor(price: StorePriceRow | undefined, channel: SaleChannel): number {
  if (!price) return 0
  return channel === 'shopeefood' ? (price.app_price ?? price.sale_price) : price.sale_price
}

export function SalePage() {
  const { current } = useStore()
  // Đổi cửa hàng thì dựng lại form để bỏ các dòng của cửa hàng cũ
  return current ? <SaleForm key={current.id} storeId={current.id} /> : null
}

function SaleForm({ storeId }: { storeId: string }) {
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  const [lines, setLines] = useState<Line[]>([])
  const [quickMode, setQuickMode] = useState<boolean | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { channel: 'in_store', sale_date: todayVN(), note: '' },
  })

  const channel = useWatch({ control, name: 'channel' })
  const saleDate = useWatch({ control, name: 'sale_date' })
  const { prices, error: pricesError } = useStorePrices(storeId, saleDate)
  const quick = quickMode ?? products.length <= QUICK_MAX
  const byId = new Map(products.map((p) => [p.id, p]))

  const suggested = (id: string) => priceFor(prices?.get(id), channel)
  const priceText = (line: Line) => line.price ?? String(suggested(line.product_id))
  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(priceText(l)) || 0), 0)

  // Món đếm tồn bán nhiều hơn số ở quầy thì cảnh báo (server vẫn chặn cuối cùng)
  const overStock = (line: Line) => {
    const product = byId.get(line.product_id)
    if (!product?.tracks_stock) return null
    const shop = stock.get(product.id)?.qty_shop ?? 0
    return (Number(line.qty) || 0) > shop ? `Vượt số ở quầy (còn ${shop})` : null
  }

  // Đổi kênh hoặc ngày thì bỏ giá đã sửa tay, dùng lại giá gợi ý mới
  const resetPrices = () => setLines((ls) => ls.map((l) => ({ ...l, price: null })))

  const onPick = (ids: string[]) => {
    setLines((ls) => [
      ...ls.filter((l) => ids.includes(l.product_id)),
      ...ids
        .filter((id) => !ls.some((l) => l.product_id === id))
        .map((id) => ({ product_id: id, qty: '1', price: null })),
    ])
  }

  // Nhập nhanh: ô trống hoặc 0 thì bỏ món; chọn món: giữ dòng, chỉ đổi số
  const setQty = (id: string, qty: string) => {
    setLines((ls) => {
      if (quick && (Number(qty) || 0) <= 0) return ls.filter((l) => l.product_id !== id)
      if (ls.some((l) => l.product_id === id)) {
        return ls.map((l) => (l.product_id === id ? { ...l, qty } : l))
      }
      return [...ls, { product_id: id, qty, price: null }]
    })
  }

  const setPrice = (id: string, price: string) => {
    setLines((ls) => ls.map((l) => (l.product_id === id ? { ...l, price } : l)))
  }

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id))

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    setFormError(null)
    if (lines.length === 0) return setFormError('Đơn bán phải có ít nhất một món')
    if (!prices) return setFormError('Đang tải giá, thử lại sau giây lát')
    const items = []
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      const unitPrice = Number(priceText(line))
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(`Số lượng của "${name}" phải là số nguyên > 0`)
      }
      if (priceText(line).trim() === '' || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return setFormError(`Đơn giá của "${name}" không hợp lệ`)
      }
      items.push({ product_id: line.product_id, quantity, unit_price: unitPrice })
    }

    const { error } = await supabase.rpc('create_sale', {
      p_store_id: storeId,
      p_sale_date: values.sale_date || null,
      p_channel: values.channel,
      p_note: values.note.trim() || null,
      p_items: items,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    setResult({ ok: true, text: `Đã lưu đơn bán ${formatVND(total)}` })
    reset({ channel: values.channel, sale_date: values.sale_date, note: '' })
    setLines([])
    reload()
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  const info = (p: Product) => {
    const parts: string[] = []
    if (prices) parts.push(prices.has(p.id) ? formatVND(suggested(p.id)) : 'chưa có giá')
    if (p.tracks_stock) parts.push(`Còn: ${stock.get(p.id)?.qty_shop ?? 0}`)
    return parts.join(' · ')
  }

  const lineFor = (id: string) => lines.find((l) => l.product_id === id)

  const priceInput = (line: Line, name: string) => (
    <input
      type="text"
      inputMode="numeric"
      className="price-input"
      aria-label={`Đơn giá ${name}`}
      value={priceText(line)}
      onChange={(e) => setPrice(line.product_id, e.target.value.replace(/[^0-9.]/g, ''))}
    />
  )

  return (
    <section>
      <h2>Bán hàng</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <div className="row">
          <label>
            Kênh bán
            <select {...register('channel', { onChange: resetPrices })}>
              <option value="in_store">Tại quầy</option>
              <option value="shopeefood">ShopeeFood</option>
            </select>
          </label>
          <label>
            Ngày bán
            <input type="date" {...register('sale_date', { required: true, onChange: resetPrices })} />
          </label>
        </div>
        {pricesError && <p className="error">Không tải được giá: {pricesError}</p>}

        <ProductPicker
          products={products}
          selectedIds={lines.map((l) => l.product_id)}
          onChange={onPick}
          renderInfo={info}
          quick={quick}
          onQuickChange={setQuickMode}
          renderQuick={(p) => {
            const line = lineFor(p.id)
            const warn = line && overStock(line)
            return (
              <div className="quick-inputs">
                <QtyStepper
                  value={line?.qty ?? ''}
                  onChange={(v) => setQty(p.id, v)}
                  min={0}
                  label={`số lượng ${p.name}`}
                />
                {line && priceInput(line, p.name)}
                {warn && <small className="warn">{warn}</small>}
              </div>
            )
          }}
        />

        {!quick && lines.length > 0 && (
          <div className="picked">
            <h3>Món đã chọn ({lines.length})</h3>
            {lines.map((line) => {
              const name = byId.get(line.product_id)?.name ?? ''
              const warn = overStock(line)
              return (
                <div key={line.product_id} className="picked-row">
                  <div className="picker-name">
                    {name}
                    {warn && <small className="warn">{warn}</small>}
                  </div>
                  <QtyStepper
                    value={line.qty}
                    onChange={(v) => setQty(line.product_id, v)}
                    min={1}
                    label={`số lượng ${name}`}
                  />
                  {priceInput(line, name)}
                  <button type="button" className="link" onClick={() => removeLine(line.product_id)}>
                    Xoá
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        <p className="total">
          {lines.length} món · Tổng tiền: <strong>{formatVND(total)}</strong>
        </p>

        {formError && <p className="error">{formError}</p>}
        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Lưu đơn bán'}
        </button>
      </form>
    </section>
  )
}
