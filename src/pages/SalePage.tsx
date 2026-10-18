import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { DatePicker } from '../components/DatePicker'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { StockAlertBanner } from '../components/StockAlertBanner'
import { useStockAlerts } from '../lib/useStockAlerts'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { useStoreCatalog, useStorePrices } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { allocateSetTotal, allocatedTotal, setTotal } from '../lib/companySale'
import type { Product, SaleChannel, StorePriceRow } from '../types/database'

// sets / set_price: chỉ dùng cho kênh Công ty (bán set mix theo giá thoả thuận)
type FormValues = { channel: SaleChannel; sale_date: string; note: string; sets: string; set_price: string }
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
  const toast = useToast()
  const { products, stock, loading, error, reload } = useStoreCatalog(storeId)
  // Banner hết / sắp hết tại quầy (chỉ số lượng); làm mới sau mỗi lần lưu đơn
  const [alertVersion, setAlertVersion] = useState(0)
  const alerts = useStockAlerts(storeId, alertVersion)
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
    defaultValues: { channel: 'in_store', sale_date: todayVN(), note: '', sets: '1', set_price: '' },
  })

  const channel = useWatch({ control, name: 'channel' })
  const saleDate = useWatch({ control, name: 'sale_date' })
  const isCompany = channel === 'company'
  const sets = Number(useWatch({ control, name: 'sets' })) || 0
  const pricePerSet = Number(useWatch({ control, name: 'set_price' })) || 0
  const { prices, error: pricesError } = useStorePrices(storeId, saleDate)
  const quick = quickMode ?? products.length <= QUICK_MAX
  const byId = new Map(products.map((p) => [p.id, p]))

  const suggested = (id: string) => priceFor(prices?.get(id), channel)
  const priceText = (line: Line) => line.price ?? String(suggested(line.product_id))
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
  const total = isCompany
    ? setTotal(sets, pricePerSet)
    : lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(priceText(l)) || 0), 0)
  // Kênh Công ty: chia tổng tiền set cho từng loại theo giá tại quầy (chỉ để báo cáo theo loại)
  const companyLines = lines.map((l) => ({
    productId: l.product_id,
    qty: Number(l.qty) || 0,
    weight: prices?.get(l.product_id)?.sale_price ?? 0,
  }))

  // Món đếm tồn chỉ bán được hàng đã chuyển ra quầy (server vẫn chặn cuối cùng)
  const overStock = (line: Line) => {
    const product = byId.get(line.product_id)
    if (!product?.tracks_stock) return null
    const row = stock.get(product.id)
    // Kênh Công ty bán từ hàng đã phân phối cho công ty
    if (isCompany) {
      const company = row?.qty_company ?? 0
      if ((Number(line.qty) || 0) <= company) return null
      return company === 0
        ? t('Chưa phân phối món này cho công ty')
        : t('Công ty chỉ còn {count}', { count: company })
    }
    const shop = row?.qty_shop ?? 0
    const home = row?.qty_home ?? 0
    if ((Number(line.qty) || 0) <= shop) return null
    if (shop === 0 && home === 0) return t('Chưa có hàng: nhập hàng rồi phân phối ra quán trước')
    if (home > 0) return t('Ở quán còn {shop}, ở nhà còn {home}: phân phối thêm ra quán trước', { shop, home })
    return t('Ở quán chỉ còn {shop}', { shop })
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
    if (isCompany) {
      if (!Number.isInteger(sets) || sets <= 0) return setFormError(t('Số set phải là số nguyên > 0'))
      if (!(pricePerSet > 0)) return setFormError(t('Nhập giá 1 set'))
      if (total > MAX_MONEY) return setFormError(t('Tổng tiền quá lớn, kiểm tra lại'))
    }
    const companyPrices = isCompany ? allocateSetTotal(total, companyLines) : null
    const items = []
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      const unitPrice = companyPrices ? (companyPrices.get(line.product_id) ?? 0) : Number(priceText(line))
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(t('Số lượng của "{name}" phải là số nguyên > 0', { name }))
      }
      if (quantity > MAX_QTY) return setFormError(t('Số lượng của "{name}" quá lớn, kiểm tra lại', { name }))
      const stockProblem = overStock(line)
      if (stockProblem) return setFormError(`"${name}": ${stockProblem}`)
      if (companyPrices) {
        items.push({ product_id: line.product_id, quantity, unit_price: unitPrice })
        continue
      }
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
      p_note: isCompany
        ? [`${sets} set × ${formatVND(pricePerSet)}`, values.note.trim()].filter(Boolean).join(' · ')
        : values.note.trim() || null,
      p_items: items,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    toast.success(
      t('Đã lưu đơn bán {amount} ngày {date}', {
        amount: formatVND(companyPrices ? allocatedTotal(companyLines, companyPrices) : total),
        date: formatDate(values.sale_date),
      }),
    )
    reset({ channel: values.channel, sale_date: values.sale_date, note: '', sets: '1', set_price: '' })
    setLines([])
    reload()
    setAlertVersion((v) => v + 1)
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  // Giá và tồn ở quầy hiện dưới tên món
  const info = (p: Product) => {
    const parts: string[] = []
    if (prices && !isCompany) parts.push(prices.has(p.id) ? formatVND(suggested(p.id)) : t('chưa có giá'))
    if (p.tracks_stock && isCompany) {
      parts.push(t('Công ty còn {count}', { count: stock.get(p.id)?.qty_company ?? 0 }))
    } else if (p.tracks_stock) {
      const shop = stock.get(p.id)?.qty_shop ?? 0
      if (shop > 0) parts.push(t('Còn {shop}', { shop }))
    }
    return parts.join(' · ')
  }
  const badge = (p: Product) => {
    if (!p.tracks_stock) return null
    if (isCompany) return (stock.get(p.id)?.qty_company ?? 0) === 0 ? t('Chưa có ở công ty') : null
    return (stock.get(p.id)?.qty_shop ?? 0) === 0 ? t('Hết ở quán') : null
  }

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
      {alerts && <StockAlertBanner alerts={alerts} />}
      <form className="pos" onSubmit={handleSubmit(onSubmit)}>
        <div className="pos-main card">
          <div className="row">
            <label className="field">
              {t('Kênh bán')}
              <select {...register('channel', { onChange: resetPrices })}>
                <option value="in_store">{t('Tại quán')}</option>
                <option value="shopeefood">ShopeeFood</option>
                <option value="company">{t('Công ty')}</option>
              </select>
            </label>
            <div className="field">
              {t('Ngày bán')}
              <Controller
                control={control}
                name="sale_date"
                rules={{ required: 'Chọn ngày bán', validate: notFuture }}
                render={({ field, fieldState }) => (
                  <DatePicker
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v)
                      resetPrices()
                    }}
                    max={todayVN()}
                    label={t('Ngày bán')}
                    invalid={!!fieldState.error}
                  />
                )}
              />
            </div>
          </div>
          {errors.sale_date && <p className="error">{t(errors.sale_date.message ?? '')}</p>}
          {isCompany && (
            <div className="company-set">
              <div className="row">
                <label className="field">
                  {t('Số set')}
                  <input type="text" inputMode="numeric" {...register('sets')} />
                </label>
                <label className="field">
                  {t('Giá 1 set')}
                  <input type="text" inputMode="numeric" placeholder={t('Ví dụ: 50000')} {...register('set_price')} />
                </label>
              </div>
              <small className="muted">
                {t('Bán set mix theo giá thoả thuận, không dùng giá tại quán. Nhập tổng số hũ từng loại của cả đơn bên dưới (ví dụ 10 set × 2 cacao = 20 cacao).')}
              </small>
            </div>
          )}
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
                  {line && !isCompany && priceInput(line, p.name)}
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
            <span className="count-pill">
              {t('{count} món · SL {qty}', { count: lines.length, qty: totalQty })}
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="pos-empty muted">
              {quick ? t('Nhập số lượng ở danh sách món bên cạnh.') : t('Chạm vào món ở bên cạnh để thêm vào đơn.')}
            </p>
          ) : quick ? (
            // Nhập nhanh: sửa ở danh sách bên trái, bên này chỉ tóm tắt
            <ul className="order-summary">
              {lines.map((line) => {
                const warn = overStock(line)
                return (
                  <li key={line.product_id} className={warn ? 'has-warn' : undefined}>
                    <span className="summary-name">{byId.get(line.product_id)?.name}</span>
                    {isCompany ? (
                      <strong>{line.qty || 0}</strong>
                    ) : (
                      <>
                        <span className="summary-qty">
                          {line.qty || 0} × {formatVND(Number(priceText(line)) || 0)}
                        </span>
                        <strong>{formatVND((Number(line.qty) || 0) * (Number(priceText(line)) || 0))}</strong>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
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
                      {!isCompany && (
                        <>
                          <span className="times">×</span>
                          {priceInput(line, name)}
                          <span className="subtotal">{formatVND(subtotal)}</span>
                        </>
                      )}
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

          <div className="pos-qty">
            <span>{t('Tổng số lượng')}</span>
            <strong>{totalQty}</strong>
          </div>
          <div className="pos-total">
            <span>{t('Tổng tiền')}</span>
            <strong>{formatVND(total)}</strong>
          </div>

          {formError && <p className="error">{t(formError)}</p>}
          {hasStockProblem && (
            <p className="error">
              {isCompany
                ? t('Có món chưa đủ hàng đã phân phối cho công ty. Sửa số lượng hoặc phân phối cho công ty trước.')
                : t('Có món chưa đủ hàng ở quán. Sửa số lượng hoặc phân phối ra quán trước.')}
            </p>
          )}
          {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
          <button type="submit" className="primary block" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </aside>

        {/* Điện thoại: tổng tiền + nút lưu luôn ở đáy màn hình */}
        <div className="pos-mobilebar">
          <div>
            <small>{t('{count} món · SL {qty}', { count: lines.length, qty: totalQty })}</small>
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
