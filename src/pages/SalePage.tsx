import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { useStoreCatalog, useStorePrices } from '../lib/useStoreCatalog'
import { errorMessage, formatVND, todayVN } from '../lib/format'
import type { SaleChannel, StorePriceRow } from '../types/database'

type Line = { product_id: string; quantity: number; unit_price: number }
type FormValues = { channel: SaleChannel; sale_date: string; note: string; items: Line[] }

const EMPTY_LINE: Line = { product_id: '', quantity: 1, unit_price: 0 }

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
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { channel: 'in_store', sale_date: todayVN(), note: '', items: [EMPTY_LINE] },
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
    rules: { minLength: { value: 1, message: 'Đơn bán phải có ít nhất một món' } },
  })

  const items = useWatch({ control, name: 'items' })
  const saleDate = useWatch({ control, name: 'sale_date' })
  const { prices, error: pricesError } = useStorePrices(storeId, saleDate)
  const total = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_price || 0), 0)
  const byId = new Map(products.map((p) => [p.id, p]))

  // Đổi kênh bán thì điền lại đơn giá theo kênh mới
  const onChannelChange = (channel: SaleChannel) => {
    getValues('items').forEach((item, index) => {
      if (item.product_id) setValue(`items.${index}.unit_price`, priceFor(prices?.get(item.product_id), channel))
    })
  }

  // Giá của ngày bán mới về thì điền lại đơn giá các dòng đã chọn
  useEffect(() => {
    if (!prices) return
    const channel = getValues('channel')
    getValues('items').forEach((item, index) => {
      if (item.product_id) setValue(`items.${index}.unit_price`, priceFor(prices.get(item.product_id), channel))
    })
  }, [prices, getValues, setValue])

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const { error } = await supabase.rpc('create_sale', {
      p_store_id: storeId,
      p_sale_date: values.sale_date || null,
      p_channel: values.channel,
      p_note: values.note.trim() || null,
      p_items: values.items,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    setResult({ ok: true, text: `Đã lưu đơn bán ${formatVND(total)}` })
    reset({ channel: values.channel, sale_date: values.sale_date, note: '', items: [EMPTY_LINE] })
    reload()
  }

  if (loading) return <p className="muted">Đang tải sản phẩm…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <section>
      <h2>Bán hàng</h2>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <div className="row">
          <label>
            Kênh bán
            <select
              {...register('channel', {
                onChange: (e) => onChannelChange(e.target.value as SaleChannel),
              })}
            >
              <option value="in_store">Tại quầy</option>
              <option value="shopeefood">ShopeeFood</option>
            </select>
          </label>
          <label>
            Ngày bán
            <input type="date" {...register('sale_date', { required: true })} />
          </label>
        </div>

        {fields.map((field, index) => {
          const product = byId.get(items[index]?.product_id)
          const row = product?.tracks_stock ? stock.get(product.id) : undefined
          const lineErrors = errors.items?.[index]
          return (
            <fieldset key={field.id} className="line">
              <label className="grow">
                Món
                <select
                  {...register(`items.${index}.product_id`, {
                    required: 'Chọn món',
                    onChange: (e) =>
                      setValue(
                        `items.${index}.unit_price`,
                        priceFor(prices?.get(e.target.value), getValues('channel')),
                      ),
                  })}
                >
                  <option value="">— Chọn món —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {prices && !prices.has(p.id) ? ' (chưa có giá)' : ''}
                    </option>
                  ))}
                </select>
                {product?.tracks_stock && (
                  <small className="muted">Ở quầy: {row?.qty_shop ?? 0}</small>
                )}
              </label>
              <label className="qty">
                Số lượng
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  {...register(`items.${index}.quantity`, {
                    valueAsNumber: true,
                    validate: (v) => (Number.isInteger(v) && v > 0) || 'Số nguyên > 0',
                  })}
                />
              </label>
              <label className="money">
                Đơn giá
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="any"
                  {...register(`items.${index}.unit_price`, {
                    valueAsNumber: true,
                    validate: (v) => (Number.isFinite(v) && v >= 0) || 'Không hợp lệ',
                  })}
                />
              </label>
              <button
                type="button"
                className="link"
                aria-label="Xoá dòng"
                onClick={() => remove(index)}
              >
                Xoá
              </button>
              {lineErrors && (
                <p className="error full">
                  {lineErrors.product_id?.message ??
                    lineErrors.quantity?.message ??
                    lineErrors.unit_price?.message}
                </p>
              )}
            </fieldset>
          )
        })}
        {errors.items?.root && <p className="error">{errors.items.root.message}</p>}
        {pricesError && <p className="error">Không tải được giá: {pricesError}</p>}

        <button type="button" onClick={() => append(EMPTY_LINE)}>
          + Thêm món
        </button>

        <label>
          Ghi chú
          <input type="text" {...register('note')} />
        </label>

        <p className="total">
          Tổng tiền: <strong>{formatVND(total)}</strong>
        </p>

        {result && <p className={result.ok ? 'success' : 'error'}>{result.text}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? 'Đang lưu…' : 'Lưu đơn bán'}
        </button>
      </form>
    </section>
  )
}
