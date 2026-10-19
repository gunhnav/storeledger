import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { DatePicker } from '../components/DatePicker'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_MONEY, MAX_QTY, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { usesDistribution, usesExpenseStylePurchase } from '../lib/storeFeatures'
import { PurchaseRowsForm } from './PurchaseRowsForm'
import type { Product, ProductPrice } from '../types/database'

type FormValues = { purchase_date: string; note: string }
// cost null = chưa sửa tay: gửi null để DB lấy giá vốn có hiệu lực vào ngày nhập
type Line = { product_id: string; qty: string; cost: string | null }

// Cửa hàng ít món thì mặc định nhập nhanh
const QUICK_MAX = 10

export function PurchasePage() {
  const { current } = useStore()
  if (!current) return null
  const autoToShop = !usesDistribution(current.code)
  return usesExpenseStylePurchase(current.code) ? (
    <PurchaseRowsForm key={current.id} storeId={current.id} autoToShop={autoToShop} />
  ) : (
    <PurchaseForm key={current.id} storeId={current.id} autoToShop={autoToShop} />
  )
}

// Nhân viên cũng nhập được, nhưng không bao giờ xem được giá vốn: ô giá để trống
// thì DB dùng giá vốn hiện hành. Chỉ admin được điền sẵn giá vốn (đọc product_prices).
function PurchaseForm({ storeId, autoToShop }: { storeId: string; autoToShop: boolean }) {
  const { t } = useI18n()
  const toast = useToast()
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

  // Giá vốn dùng để điền sẵn (chỉ admin; nhân viên luôn trống, DB tự lấy giá vốn).
  // exact: có giá vốn hiệu lực vào ngày nhập. Không có thì lấy giá vốn gần nhất áp dụng sau
  // ngày nhập (ví dụ vừa nhập giá vốn hôm nay nhưng ghi đợt nhập lùi ngày) và gửi rõ con số đó.
  const currentCost = (id: string): { cost: number; from: string; exact: boolean } | null => {
    const effective = costHistory.find((r) => r.product_id === id && r.effective_from <= purchaseDate)
    if (effective && effective.unit_cost !== null) {
      return { cost: effective.unit_cost, from: effective.effective_from, exact: true }
    }
    const later = costHistory
      .filter((r) => r.product_id === id && r.effective_from > purchaseDate && r.unit_cost !== null)
      .at(-1)
    return later && later.unit_cost !== null
      ? { cost: later.unit_cost, from: later.effective_from, exact: false }
      : null
  }
  const costText = (line: Line) => {
    if (line.cost !== null) return line.cost
    const current = currentCost(line.product_id)
    return current === null ? '' : String(current.cost)
  }
  // Nhắc khi giá điền sẵn là giá áp dụng sau ngày nhập
  const costHint = (line: Line) => {
    if (line.cost !== null) return null
    const current = currentCost(line.product_id)
    return current && !current.exact
      ? t('Dùng giá vốn áp dụng từ {date}', { date: formatDate(current.from) })
      : null
  }
  const blankCostLabel = isAdmin ? t('Chưa có giá vốn') : t('Giá vốn hiện hành')
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)
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
    if (lines.length === 0) return setFormError(t('Đợt nhập phải có ít nhất một sản phẩm'))
    const items = []
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(t('Số lượng của "{name}" phải là số nguyên > 0', { name }))
      }
      if (quantity > MAX_QTY) return setFormError(t('Số lượng của "{name}" quá lớn, kiểm tra lại', { name }))
      // Admin thấy được giá vốn nên báo sớm món chưa có giá vốn mà ô giá để trống
      if (isAdmin && costText(line) === '') {
        return setFormError(t('"{name}" chưa có giá vốn: nhập giá nhập cho món này', { name }))
      }
      // Chỉ gửi giá khi người dùng tự gõ; còn lại để DB lấy giá vốn hiện hành
      // Gửi giá khi người dùng tự gõ, hoặc khi giá điền sẵn là giá áp dụng sau ngày nhập
      const typed = line.cost?.trim() ?? ''
      const prefilled = currentCost(line.product_id)
      const unitCost =
        typed !== '' ? Number(typed) : isAdmin && prefilled && !prefilled.exact ? prefilled.cost : null
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
        return setFormError(t('Giá nhập của "{name}" không hợp lệ', { name }))
      }
      if (unitCost !== null && unitCost > MAX_MONEY) {
        return setFormError(t('Giá nhập của "{name}" quá lớn, kiểm tra lại', { name }))
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
    // Quán không có bước Phân phối: chuyển ngay toàn bộ hàng vừa nhập ra quán (cùng ngày nhập)
    if (autoToShop) {
      const failed: string[] = []
      for (const item of items) {
        if (!byId.get(item.product_id)?.tracks_stock) continue
        const { error: moveError } = await supabase.rpc('create_transfer', {
          p_store_id: storeId,
          p_product_id: item.product_id,
          p_quantity: item.quantity,
          p_transfer_date: values.purchase_date || null,
          p_note: 'Tự vào quán khi nhập hàng',
          p_destination: 'shop',
        })
        if (moveError) failed.push(`${byId.get(item.product_id)?.name ?? ''}: ${t(errorMessage(moveError))}`)
      }
      if (failed.length > 0) {
        setResult({ ok: false, text: t('Đã nhập hàng nhưng chưa đưa vào quán được: {list}', { list: failed.join('; ') }) })
        reload()
        return
      }
    }
    toast.success(
      t('Đã lưu đợt nhập {count} món ngày {date}', { count: lines.length, date: formatDate(values.purchase_date) }),
    )
    reset({ purchase_date: values.purchase_date, note: '' })
    setLines([])
    reload()
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const info = (p: Product) =>
    autoToShop
      ? t('Ở quán: {value}', { value: stock.get(p.id)?.qty_shop ?? 0 })
      : t('Ở nhà: {value}', { value: stock.get(p.id)?.qty_home ?? 0 })
  const lineFor = (id: string) => lines.find((l) => l.product_id === id)

  const costInput = (line: Line, name: string) => (
    <input
      type="text"
      inputMode="numeric"
      className="price-input"
      placeholder={blankCostLabel}
      title={costHint(line) ?? undefined}
      aria-label={t('Giá nhập {name}', { name })}
      value={costText(line)}
      onChange={(e) => setCost(line.product_id, e.target.value.replace(/[^0-9.]/g, ''))}
    />
  )

  const submitLabel = isSubmitting ? t('Đang lưu…') : t('Lưu đợt nhập')
  const canSubmit = !isSubmitting && lines.length > 0

  return (
    <section>
      <form className="pos" onSubmit={handleSubmit(onSubmit)}>
        <div className="pos-main card">
          <div className="field">
            {t('Ngày nhập')}
            <Controller
              control={control}
              name="purchase_date"
              rules={{ required: 'Chọn ngày nhập', validate: notFuture }}
              render={({ field, fieldState }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  max={todayVN()}
                  label={t('Ngày nhập')}
                  invalid={!!fieldState.error}
                />
              )}
            />
          </div>
          {errors.purchase_date && <p className="error">{t(errors.purchase_date.message ?? '')}</p>}

          {stocked.length === 0 ? (
            <p className="pos-empty muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>
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
                    {line && costHint(line) && <small className="warn">{costHint(line)}</small>}
                    {line && costInput(line, p.name)}
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
          )}
        </div>

        <aside className="pos-side card">
          <div className="pos-side-head">
            <h3>{t('Đợt nhập')}</h3>
            <span className="count-pill">
              {t('{count} món · SL {qty}', { count: lines.length, qty: totalQty })}
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="pos-empty muted">
              {quick ? t('Nhập số lượng ở danh sách món bên cạnh.') : t('Chạm vào món ở bên cạnh để thêm vào đợt nhập.')}
            </p>
          ) : quick ? (
            // Nhập nhanh: sửa ở danh sách bên trái, bên này chỉ tóm tắt
            <ul className="order-summary">
              {lines.map((line) => (
                <li key={line.product_id}>
                  <span className="summary-name">{byId.get(line.product_id)?.name}</span>
                  <span className="summary-qty">
                    {line.qty || 0} × {costText(line) === '' ? blankCostLabel : formatVND(Number(costText(line)) || 0)}
                  </span>
                  <strong>
                    {costText(line) === '' ? '—' : formatVND((Number(line.qty) || 0) * (Number(costText(line)) || 0))}
                  </strong>
                </li>
              ))}
            </ul>
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
                      {costInput(line, name)}
                      <span className="subtotal">
                        {costText(line) === '' ? '—' : formatVND((Number(line.qty) || 0) * (cost || 0))}
                      </span>
                    </div>
                    {costHint(line) && <small className="warn">{costHint(line)}</small>}
                  </div>
                )
              })}
            </div>
          )}

          <small className="muted">
            {t('Ô giá nhập để trống thì dùng giá vốn đang áp dụng vào ngày nhập (đặt ở Quản lý → Sản phẩm).')}
          </small>

          <label className="field">
            {t('Ghi chú')}
            <input type="text" placeholder={t('Không bắt buộc')} {...register('note')} />
          </label>

          <div className="pos-qty">
            <span>{t('Tổng số lượng')}</span>
            <strong>{totalQty}</strong>
          </div>
          <div className="pos-total">
            <span className="pos-total-label">
              {t('Tổng tiền nhập')}
              {hasBlankCost && <small>{t('(chưa gồm món để trống giá)')}</small>}
            </span>
            <strong>{formatVND(total)}</strong>
          </div>

          {formError && <p className="error">{t(formError)}</p>}
          {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
          <button type="submit" className="primary block" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </aside>

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
