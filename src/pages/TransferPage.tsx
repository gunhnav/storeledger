import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { DatePicker } from '../components/DatePicker'
import { ProductPicker, QtyStepper } from '../components/ProductPicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { useStoreCatalog } from '../lib/useStoreCatalog'
import { MAX_QTY, errorMessage, formatDate, todayVN } from '../lib/format'
import type { Product } from '../types/database'
import { TransferGrid } from './TransferGrid'
import { CompanyDistribution } from './CompanyDistribution'
import { TransferHistory } from './TransferHistory'

type FormValues = { transfer_date: string; note: string }
type Line = { product_id: string; qty: string }

// Cửa hàng ít món thì mặc định nhập nhanh
const QUICK_MAX = 10

// Tab "Phân phối": hàng từ nhà ra Quán (theo đơn hoặc dạng lưới) hoặc cho Công ty (theo set 4 / set 6)
export function TransferPage() {
  const { t } = useI18n()
  const { current } = useStore()
  const [params, setParams] = useSearchParams()
  const toParam = params.get('to')
  const to = toParam === 'company' || toParam === 'home' || toParam === 'history' ? toParam : 'shop'
  const view = params.get('view') === 'grid' ? 'grid' : 'form'
  if (!current) return null
  const go = (next: { to?: string; view?: string }) => {
    const merged = { to, view, ...next }
    const search: Record<string, string> = {}
    if (merged.to === 'company') search.to = 'company'
    else if (merged.to === 'home') search.to = 'home'
    else if (merged.to === 'history') search.to = 'history'
    else if (merged.view === 'grid') search.view = 'grid'
    setParams(search, { replace: true })
  }
  const segmented = (label: string, value: string, options: [string, string][], onPick: (v: string) => void) => (
    <div className="segmented" role="radiogroup" aria-label={t(label)}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? 'active' : undefined}
          onClick={() => onPick(v)}
        >
          {t(text)}
        </button>
      ))}
    </div>
  )
  return (
    <>
      <div className="transfer-view">
        {segmented('Nơi nhận', to, [
          ['shop', 'Ra quán'],
          ['company', 'Cho công ty'],
          ['home', 'Về nhà'],
          ['history', 'Lịch sử'],
        ], (v) => go({ to: v }))}
        {to === 'shop' &&
          segmented('Cách nhập', view, [
            ['form', 'Theo đơn'],
            ['grid', 'Dạng lưới theo ngày'],
          ], (v) => go({ view: v }))}
      </div>
      {to === 'history' ? (
        <TransferHistory key={current.id} storeId={current.id} />
      ) : to === 'company' ? (
        <CompanyDistribution key={current.id} storeId={current.id} />
      ) : to === 'home' ? (
        <TransferForm key={`${current.id}-back`} storeId={current.id} mode="back" />
      ) : view === 'grid' ? (
        <TransferGrid key={current.id} storeId={current.id} />
      ) : (
        <TransferForm key={current.id} storeId={current.id} />
      )}
    </>
  )
}

// mode 'out': nhà -> quán (Phân phối). mode 'back': quán -> nhà (chuyển lại, ví dụ lấy hũ từ quán lên công ty bán:
// chuyển về nhà rồi phân phối cho công ty).
function TransferForm({ storeId, mode = 'out' }: { storeId: string; mode?: 'out' | 'back' }) {
  const back = mode === 'back'
  const { t } = useI18n()
  const toast = useToast()
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
  } = useForm<FormValues>({ defaultValues: { transfer_date: todayVN(), note: '' } })

  const stocked = products.filter((p) => p.tracks_stock)
  const quick = quickMode ?? stocked.length <= QUICK_MAX
  const byId = new Map(stocked.map((p) => [p.id, p]))

  // Chuyển nhiều hơn số đang có ở nơi chuyển đi (nhà, hoặc quán khi chuyển về nhà) thì cảnh báo và không cho lưu
  const overHome = (line: Line) => {
    const row = stock.get(line.product_id)
    if (back) {
      const shop = row?.qty_shop ?? 0
      if ((Number(line.qty) || 0) <= shop) return null
      return shop === 0 ? t('Ở quán hết hàng') : t('Vượt số ở quán (còn {shop})', { shop })
    }
    const home = row?.qty_home ?? 0
    if ((Number(line.qty) || 0) <= home) return null
    return home === 0 ? t('Ở nhà hết hàng: nhập hàng trước') : t('Vượt số ở nhà (còn {home})', { home })
  }

  const onPick = (ids: string[]) => {
    setLines((ls) => [
      ...ls.filter((l) => ids.includes(l.product_id)),
      ...ids
        .filter((id) => !ls.some((l) => l.product_id === id))
        .map((id) => ({ product_id: id, qty: '1' })),
    ])
  }

  // Nhập nhanh: ô trống hoặc 0 thì bỏ món; chọn món: giữ dòng, chỉ đổi số
  const setQty = (id: string, qty: string) => {
    setLines((ls) => {
      if (quick && (Number(qty) || 0) <= 0) return ls.filter((l) => l.product_id !== id)
      if (ls.some((l) => l.product_id === id)) {
        return ls.map((l) => (l.product_id === id ? { ...l, qty } : l))
      }
      return [...ls, { product_id: id, qty }]
    })
  }

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.product_id !== id))

  // DB chỉ có create_transfer cho từng món nên gọi lần lượt; món lỗi giữ lại trong form để lưu lại
  const onSubmit = async (values: FormValues) => {
    setResult(null)
    setFormError(null)
    if (lines.length === 0) return setFormError(t('Chưa chọn món nào'))
    for (const line of lines) {
      const name = byId.get(line.product_id)?.name ?? ''
      const quantity = Number(line.qty)
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return setFormError(t('Số lượng của "{name}" phải là số nguyên > 0', { name }))
      }
      if (quantity > MAX_QTY) return setFormError(t('Số lượng của "{name}" quá lớn, kiểm tra lại', { name }))
      const warn = overHome(line)
      if (warn) return setFormError(`"${name}": ${warn}`)
    }

    const done: string[] = []
    const failed: { line: Line; message: string }[] = []
    for (const line of lines) {
      const args = {
        p_store_id: storeId,
        p_product_id: line.product_id,
        p_quantity: Number(line.qty),
        p_transfer_date: values.transfer_date || null,
        p_note: values.note.trim() || null,
      }
      const { error } = back
        ? await supabase.rpc('create_shop_return', args)
        : await supabase.rpc('create_transfer', { ...args, p_destination: 'shop' })
      const name = byId.get(line.product_id)?.name ?? ''
      if (error) failed.push({ line, message: `${name}: ${errorMessage(error)}` })
      else done.push(`${line.qty} ${name}`)
    }

    reload()
    if (failed.length === 0) {
      toast.success(
        back
          ? t('Đã chuyển về nhà ngày {date}: {list}', { date: formatDate(values.transfer_date), list: done.join(', ') })
          : t('Đã phân phối ngày {date}: {list}', { date: formatDate(values.transfer_date), list: done.join(', ') }),
      )
      reset({ transfer_date: values.transfer_date, note: '' })
      setLines([])
      return
    }
    setLines(failed.map((f) => f.line))
    setResult({
      ok: false,
      text:
        (done.length > 0 ? t(back ? 'Đã chuyển về nhà: {list}. ' : 'Đã phân phối: {list}. ', { list: done.join(', ') }) : '') +
        t(back ? 'Chưa chuyển (còn trong form để lưu lại): {list}' : 'Chưa phân phối (còn trong form để lưu lại): {list}', { list: failed.map((f) => f.message).join('; ') }),
    })
  }

  if (loading) return <p className="muted">{t('Đang tải sản phẩm…')}</p>
  if (error) return <p className="error">{t(error)}</p>

  const info = (p: Product) => {
    const row = stock.get(p.id)
    return t('Ở nhà: {value} · Ở quán: {value2}', { value: row?.qty_home ?? 0, value2: row?.qty_shop ?? 0 })
  }
  const badge = (p: Product) =>
    back
      ? (stock.get(p.id)?.qty_shop ?? 0) === 0
        ? t('Ở quán hết')
        : null
      : (stock.get(p.id)?.qty_home ?? 0) === 0
        ? t('Ở nhà hết')
        : null
  const lineFor = (id: string) => lines.find((l) => l.product_id === id)
  const hasWarning = lines.some((l) => overHome(l) !== null)
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0)

  const submitLabel = isSubmitting ? t('Đang lưu…') : back ? t('Chuyển về nhà') : t('Phân phối')
  const canSubmit = !isSubmitting && !hasWarning && lines.length > 0

  return (
    <section>
      <form className="pos" onSubmit={handleSubmit(onSubmit)}>
        <div className="pos-main card">
          <div className="field">
            {back ? t('Ngày chuyển') : t('Ngày phân phối')}
            <Controller
              control={control}
              name="transfer_date"
              rules={{ required: back ? 'Chọn ngày chuyển' : 'Chọn ngày phân phối' }}
              render={({ field, fieldState }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  label={back ? t('Ngày chuyển') : t('Ngày phân phối')}
                  invalid={!!fieldState.error}
                />
              )}
            />
          </div>
          {errors.transfer_date && <p className="error">{t(errors.transfer_date.message ?? '')}</p>}

          {stocked.length === 0 ? (
            <p className="pos-empty muted">{t('Cửa hàng chưa có món nào đếm tồn kho.')}</p>
          ) : (
            <ProductPicker
              products={stocked}
              selectedIds={lines.map((l) => l.product_id)}
              onChange={onPick}
              renderInfo={info}
              renderBadge={badge}
              quick={quick}
              onQuickChange={setQuickMode}
              renderQuick={(p) => {
                const line = lineFor(p.id)
                const warn = line && overHome(line)
                return (
                  <div className="quick-inputs">
                    {warn && <small className="warn">{warn}</small>}
                    <QtyStepper
                      value={line?.qty ?? ''}
                      onChange={(v) => setQty(p.id, v)}
                      min={0}
                      label={t('số lượng phân phối {name}', { name: p.name })}
                    />
                  </div>
                )
              }}
            />
          )}
        </div>

        <aside className="pos-side card">
          <div className="pos-side-head">
            <h3>{back ? t('Chuyển về nhà') : t('Phân phối')}</h3>
            <span className="count-pill">{t('{count} món', { count: lines.length })}</span>
          </div>

          {lines.length === 0 ? (
            <p className="pos-empty muted">
              {quick ? t('Nhập số lượng ở danh sách món bên cạnh.') : t('Chạm vào món ở bên cạnh để chọn.')}
            </p>
          ) : quick ? (
            // Nhập nhanh: sửa ở danh sách bên trái, bên này chỉ tóm tắt
            <ul className="order-summary">
              {lines.map((line) => {
                const warn = overHome(line)
                return (
                  <li key={line.product_id} className={warn ? 'has-warn' : undefined}>
                    <span className="summary-name">{byId.get(line.product_id)?.name}</span>
                    <strong>{line.qty || 0}</strong>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="order-lines">
              {lines.map((line) => {
                const name = byId.get(line.product_id)?.name ?? ''
                const warn = overHome(line)
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
                        label={t('số lượng phân phối {name}', { name })}
                      />
                      <span className="subtotal">
                        {back
                          ? t('Ở quán còn {count}', { count: stock.get(line.product_id)?.qty_shop ?? 0 })
                          : t('Ở nhà còn {count}', { count: stock.get(line.product_id)?.qty_home ?? 0 })}
                      </span>
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
            <span>{t('Tổng số lượng')}</span>
            <strong>{totalQty}</strong>
          </div>

          {formError && <p className="error">{t(formError)}</p>}
          {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
          <button type="submit" className="primary block" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </aside>

        <div className="pos-mobilebar">
          <div>
            <small>{t('{count} món', { count: lines.length })}</small>
            <strong>{t('{count} hộp/phần', { count: totalQty })}</strong>
          </div>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </section>
  )
}
