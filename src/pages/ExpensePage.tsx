import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { DatePicker } from '../components/DatePicker'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { MAX_MONEY, errorMessage, formatDate, formatVND, notFuture, todayVN } from '../lib/format'
import type { Expense } from '../types/database'

type FormValues = { expense_date: string; category: string; amount: number; note: string }

// Gợi ý sẵn, cộng thêm các nhóm đã dùng gần đây
const SUGGESTED_CATEGORIES = ['Mặt bằng', 'Điện nước', 'Lương', 'Đồ dùng', 'Bao bì', 'Vận chuyển']

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
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { expense_date: todayVN(), category: '', amount: Number.NaN, note: '' },
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

  const categories = [...new Set([...SUGGESTED_CATEGORIES, ...(recent?.rows ?? []).map((r) => r.category)])]

  const onSubmit = async (values: FormValues) => {
    setResult(null)
    const { error } = await supabase.from('expenses').insert({
      store_id: storeId,
      expense_date: values.expense_date,
      category: values.category.trim(),
      amount: values.amount,
      note: values.note.trim() || null,
    })
    if (error) {
      setResult({ ok: false, text: errorMessage(error) })
      return
    }
    toast.success(
      t('Đã lưu chi phí {amount} ngày {date}', { amount: formatVND(values.amount), date: formatDate(values.expense_date) }),
    )
    reset({ expense_date: values.expense_date, category: '', amount: Number.NaN, note: '' })
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
            {t('Số tiền')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step="any"
              {...register('amount', {
                valueAsNumber: true,
                validate: (v) =>
                  !Number.isFinite(v) || v <= 0
                    ? 'Số tiền phải lớn hơn 0'
                    : v > MAX_MONEY
                      ? 'Số tiền quá lớn, kiểm tra lại'
                      : true,
              })}
            />
          </label>
        </div>
        {(errors.expense_date || errors.amount) && (
          <p className="error">{t(errors.expense_date?.message ?? errors.amount?.message ?? '')}</p>
        )}

        <label>
          {t('Nhóm chi phí')}
          <input
            type="text"
            list="expense-categories"
            {...register('category', {
              validate: (v) =>
                v.trim() === '' ? 'Nhập nhóm chi phí' : v.trim().length > 50 ? 'Tối đa 50 ký tự' : true,
            })}
          />
          <datalist id="expense-categories">
            {categories.map((c) => (
              <option key={c} value={t(c)} />
            ))}
          </datalist>
        </label>
        {errors.category && <p className="error">{t(errors.category.message ?? '')}</p>}

        <label>
          {t('Ghi chú')}
          <input type="text" {...register('note')} />
        </label>

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
                <th className="num">{t('Số tiền')}</th>
                <th>{t('Ghi chú')}</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.expense_date.split('-').reverse().join('/')}</td>
                  <td>{r.category}</td>
                  <td className="num">{formatVND(r.amount)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
