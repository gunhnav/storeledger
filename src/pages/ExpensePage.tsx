import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { MAX_MONEY, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import { EXPENSE_GROUPS, expenseLine, storedUnitPrice } from '../lib/expenses'
import type { Expense } from '../types/database'

type FormValues = { expense_date: string; category: string; note: string }

// Số lượng / đơn giá / thành tiền giữ dạng chuỗi để cho phép ô trống khi đang gõ
const EMPTY_AMOUNTS = { quantity: '1', unitPrice: '', total: '' }
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))
const cleanNumber = (text: string) => text.replace(/[^0-9.]/g, '')

export function ExpensePage() {
  const { current } = useStore()
  return current ? <ExpenseForm key={current.id} storeId={current.id} /> : null
}

// Chỉ admin (route bọc RequireAdmin, RLS cũng chặn)
function ExpenseForm({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const [recent, setRecent] = useState<{ rows: Expense[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // total khác '' nghĩa là người dùng ghi đè thành tiền
  const [amounts, setAmounts] = useState(EMPTY_AMOUNTS)
  const quantity = toNumber(amounts.quantity)
  const override = amounts.total.trim() === '' ? null : toNumber(amounts.total)
  const line = expenseLine(quantity, toNumber(amounts.unitPrice) || 0, override)
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { expense_date: todayVN(), category: 'Dụng cụ', note: '' },
  })

  useEffect(() => {
    let cancelled = false
    supabase
      .from('expenses')
      .select('*')
      .eq('store_id', storeId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!cancelled) setRecent({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) {
      return setResult({ ok: false, text: 'Số lượng phải lớn hơn 0' })
    }
    if (override === null && (!Number.isFinite(toNumber(amounts.unitPrice)) || toNumber(amounts.unitPrice) < 0)) {
      return setResult({ ok: false, text: 'Nhập đơn giá hoặc thành tiền' })
    }
    if (!Number.isFinite(line.total) || line.total <= 0) return setResult({ ok: false, text: 'Số tiền phải lớn hơn 0' })
    if (line.total > MAX_MONEY) return setResult({ ok: false, text: 'Số tiền quá lớn, kiểm tra lại' })
    const { error } = await supabase.from('expenses').insert({
      store_id: storeId,
      expense_date: values.expense_date,
      category: values.category,
      quantity,
      unit_price: storedUnitPrice(line.unitPrice),
      amount: line.total,
      note: values.note.trim() || null,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    toast.success(
      t('Đã lưu chi phí {amount} ngày {date}', { amount: formatVND(line.total), date: formatDate(values.expense_date) }),
    )
    reset({ expense_date: values.expense_date, category: values.category, note: '' })
    setAmounts(EMPTY_AMOUNTS)
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <form className="card form" onSubmit={handleSubmit(onSubmit)}>
        <div className="row">
          <div className="field">
            {t('Ngày')}
            <Controller
              control={control}
              name="expense_date"
              rules={{ required: 'Chọn ngày', validate: notFuture }}
              render={({ field, fieldState }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  max={todayVN()}
                  label={t('Ngày')}
                  invalid={!!fieldState.error}
                />
              )}
            />
          </div>
          <label>
            {t('Nhóm chi phí')}
            <select {...register('category', { required: true })}>
              {EXPENSE_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(g)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {errors.expense_date && <p className="error">{t(errors.expense_date.message ?? '')}</p>}

        <label>
          {t('Hạng mục / ghi chú')}
          <input type="text" placeholder={t('Ví dụ: thìa, banner, thùng giữ lạnh')} {...register('note')} />
        </label>

        <div className="row expense-amounts">
          <label>
            {t('Số lượng')}
            <input
              type="text"
              inputMode="decimal"
              value={amounts.quantity}
              onChange={(e) => setAmounts((a) => ({ ...a, quantity: cleanNumber(e.target.value) }))}
            />
          </label>
          <label>
            {t('Đơn giá')}
            <input
              type="text"
              inputMode="numeric"
              className={line.overridden ? 'computed' : undefined}
              readOnly={line.overridden}
              value={line.overridden ? (Number.isFinite(line.unitPrice) ? formatVND(line.unitPrice) : '') : amounts.unitPrice}
              onChange={(e) => setAmounts((a) => ({ ...a, unitPrice: cleanNumber(e.target.value) }))}
            />
          </label>
          <label>
            <span className="label-row">
              {t('Thành tiền')}
              {line.overridden && (
                <button type="button" className="link" onClick={() => setAmounts((a) => ({ ...a, total: '' }))}>
                  {t('Tính lại')}
                </button>
              )}
            </span>
            <input
              type="text"
              inputMode="numeric"
              className={line.overridden ? 'overridden' : undefined}
              placeholder={Number.isFinite(line.total) && line.total > 0 ? formatVND(line.total) : t('= số lượng × đơn giá')}
              value={amounts.total}
              onChange={(e) => setAmounts((a) => ({ ...a, total: cleanNumber(e.target.value) }))}
            />
          </label>
        </div>
        <small className="muted">
          {line.overridden
            ? t('Đang ghi đè thành tiền: đơn giá = thành tiền ÷ số lượng.')
            : t('Thành tiền tự tính = số lượng × đơn giá. Gõ vào ô Thành tiền để ghi đè.')}
        </small>

        {result && <p className={result.ok ? 'success' : 'error'}>{t(result.text)}</p>}
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? t('Đang lưu…') : t('Lưu chi phí')}
        </button>
      </form>

      <h2 className="section-title">{t('20 chi phí gần nhất')}</h2>
      {!recent ? (
        <p className="muted">{t('Đang tải…')}</p>
      ) : recent.error ? (
        <p className="error">{t(recent.error)}</p>
      ) : recent.rows.length === 0 ? (
        <p className="muted">{t('Chưa có chi phí nào.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Ngày')}</th>
                <th>{t('Nhóm')}</th>
                <th>{t('Hạng mục / ghi chú')}</th>
                <th className="num">{t('Số lượng')}</th>
                <th className="num">{t('Đơn giá')}</th>
                <th className="num">{t('Thành tiền')}</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.expense_date.split('-').reverse().join('/')}</td>
                  <td>{t(r.category)}</td>
                  <td>{r.note}</td>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{formatVND(r.unit_price)}</td>
                  <td className="num">
                    <strong>{formatVND(r.amount)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
