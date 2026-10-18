import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { useStoreCatalog, useStorePrices } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, errorMessage, formatVND, notFuture, todayVN } from '../lib/format'
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
  const { t } = useI18n()
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
    formState: { errors, isSubmitting },
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

  // Món đếm tồn chỉ bán được hàng đã chuyển ra quầy (server vẫn chặn cuối cùng)
  const overStock = (line: Line) => {
    const product = byId.get(line.product_id)
    if (!product?.tracks_stock) return null
    const row = stock.get(product.id)
    const shop = row?.qty_shop ?? 0
    const home = row?.qty_home ?? 0
    if ((Number(line.qty) || 0) <= shop) return null
    if (shop === 0 && home === 0) return t('Chưa có hàng: nhập hàng rồi chuyển ra quầy trước')
    if (home > 0) return t('Ở quầy còn {shop}, ở nhà còn {home}: chuyển thêm ra quầy trước', { shop, home })
    return t('Ở quầy chỉ còn {shop}', { shop })
  }
  const hasStockProblem = lines.some((l) => overStock(l) !== null)

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
    if (lines.length === 0) return setFormError(t('Đơn bán phải có ít nhất một món'))
    if (!prices) return setFormError(t('Đang tải giá, thử lại sau giây lát'))
    const items = []
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      const unitPrice = Number(priceText(line))
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(t('Số lượng của "{name}" phải là số nguyên > 0', { name }))
      }
      if (quantity > MAX_QTY) return setFormError(t('Số lượng của "{name}" quá lớn, kiểm tra lại', { name }))
      const stockProblem = overStock(line)
      if (stockProblem) return setFormError(`"${name}": ${stockProblem}`)
      if (line.price === null && !prices.has(line.product_id)) {
        return setFormError(t('"{name}" chưa có giá bán vào ngày này: nhập đơn giá hoặc nhờ admin đặt giá', { name }))
      }
      if (priceText(line).trim() === '' || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return setFormError(t('Đơn giá của "{name}" không hợp lệ', { name }))
      }
      if (unitPrice > MAX_MONEY) return setFormError(t('Đơn giá của "{name}" quá lớn, kiểm tra lại', { name }))
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
    setResult({ ok: true, text: t('Đã lưu đơn bán {amount}', { amount: formatVND(total) }) })
    reset({ channel: values.channel, sale_date: values.sale_date, note: '' })
    setLines([])
    reload()
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  // Giá và tồn ở quầy hiện dưới tên món
  const info = (p: Product) => {
    const parts: string[] = []
    if (prices) parts.push(prices.has(p.id) ? formatVND(suggested(p.id)) : t('chưa có giá'))
    if (p.tracks_stock) {
      const shop = stock.get(p.id)?.qty_shop ?? 0
      if (shop > 0) parts.push(t('Còn {shop}', { shop }))
    }
    return parts.join(' · ')
  }
  const badge = (p: Product) =>
    p.tracks_stock && (stock.get(p.id)?.qty_shop ?? 0) === 0 ? t('Hết ở quầy') : null

  const lineFor = (id: string) => lines.find((l) => l.product_id === id)

  const priceInput = (line: Line, name: string) => (
    <input
      type="text"
      inputMode="numeric"
      className="price-input"
      aria-label={t('Đơn giá {name}', { name })}
      value={priceText(line)}
      onChange={(e) => setPrice(line.product_id, e.target.value.replace(/[^0-9.]/g, ''))}
    />
  )

  const submitLabel = isSubmitting ? t('Đang lưu…') : t('Lưu đơn bán')
  const canSubmit = !isSubmitting && !hasStockProblem && lines.length > 0

  return (
    <section>
      <h2>{t('Bán hàng')}</h2>
      <form className="pos" onSubmit={handleSubmit(onSubmit)}>
        <div className="pos-main card">
          <div className="row">
            <label className="field">
              {t('Kênh bán')}
              <select {...register('channel', { onChange: resetPrices })}>
                <option value="in_store">{t('Tại quầy')}</option>
                <option value="shopeefood">ShopeeFood</option>
              </select>
            </label>
            <label className="field">
              {t('Ngày bán')}
              <input
                type="date"
                max={todayVN()}
                {...register('sale_date', { required: 'Chọn ngày bán', validate: notFuture, onChange: resetPrices })}
              />
            </label>
          </div>
          {errors.sale_date && <p className="error">{t(errors.sale_date.message ?? '')}</p>}
          {pricesError && <p className="error">{t('Không tải được giá: {error}', { error: pricesError })}</p>}

          <ProductPicker
            products={products}
            selectedIds={lines.map((l) => l.product_id)}
            onChange={onPick}
            renderInfo={info}
            renderBadge={badge}
            quick={quick}
            onQuickChange={setQuickMode}
            renderQuick={(p) => {
              const line = lineFor(p.id)
              const warn = line && overStock(line)
              return (
                <div className="quick-inputs">
                  {warn && <small className="warn">{warn}</small>}
                  {line && priceInput(line, p.name)}
                  <QtyStepper
                    value={line?.qty ?? ''}
                    onChange={(v) => setQty(p.id, v)}
                    min={0}
                    label={t('số lượng {name}', { name: p.name })}
                  />
                </div>
              )
            }}
          />
        </div>

        <aside className="pos-side card">
          <div className="pos-side-head">
            <h3>{t('Đơn hàng')}</h3>
            <span className="count-pill">{t('{count} món', { count: lines.length })}</span>
          </div>

          {lines.length === 0 ? (
            <p className="pos-empty muted">
              {quick ? t('Nhập số lượng ở danh sách món bên cạnh.') : t('Chạm vào món ở bên cạnh để thêm vào đơn.')}
            </p>
          ) : (
            <div className="order-lines">
              {lines.map((line) => {
                const name = byId.get(line.product_id)?.name ?? ''
                const warn = overStock(line)
                const subtotal = (Number(line.qty) || 0) * (Number(priceText(line)) || 0)
                return (
                  <div key={line.product_id} className={`order-line${warn ? ' has-warn' : ''}`}>
                    <div className="order-line-top">
                      <span className="order-line-name">{name}</span>
                      <button
                        type="button"
                        className="remove"
                        aria-label={t('Xoá {name}', { name })}
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
                        label={t('số lượng {name}', { name })}
                      />
                      <span className="times">×</span>
                      {priceInput(line, name)}
                      <span className="subtotal">{formatVND(subtotal)}</span>
                    </div>
                    {warn && <small className="warn">{warn}</small>}
                  </div>
                )
              })}
            </div>
          )}

          <label className="field">
            {t('Ghi chú')}
            <input type="text" placeholder={t('Không bắt buộc')} {...register('note')} />
          </label>

          <div className="pos-total">
            <span>{t('Tổng tiền')}</span>
            <strong>{formatVND(total)}</strong>
          </div>

          {formError && <p className="error">{t(formError)}</p>}
          {hasStockProblem && (
            <p className="error">{t('Có món chưa đủ hàng ở quầy. Sửa số lượng hoặc chuyển hàng ra quầy trước.')}</p>
          )}
          {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
          <button type="submit" className="primary block" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </aside>

        {/* Điện thoại: tổng tiền + nút lưu luôn ở đáy màn hình */}
        <div className="pos-mobilebar">
          <div>
            <small>{t('{count} món', { count: lines.length })}</small>
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
