import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useStore } from '../lib/store'
import { errorMessage } from '../lib/format'
import { formatQty, ingredientStatus, normalizeRecipeLines } from '../lib/ingredients'
import type { Ingredient, IngredientStockRow, Product, Recipe } from '../types/database'

export function IngredientsPage() {
  const { current } = useStore()
  return current ? <IngredientsManager key={current.id} storeId={current.id} /> : null
}

type Data = { ingredients: Ingredient[]; stock: Map<string, IngredientStockRow>; dishes: Product[]; recipes: Recipe[] }
type Line = { ingredient_id: string; qty: string }

const normalize = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd')

// Chỉ admin. Nguyên liệu (chả cốm, chả ốc...) và công thức: một phần món dùng bao nhiêu nguyên liệu.
// Tồn kho nguyên liệu = tổng nhập - Σ (số phần đã bán × định lượng).
function IngredientsManager({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('ingredients').select('*').eq('store_id', storeId).eq('is_active', true).order('name'),
      supabase.rpc('get_ingredient_stock', { p_store_id: storeId }),
      supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true).eq('tracks_stock', false).order('name'),
      supabase.from('recipes').select('*'),
    ]).then(([ing, stock, prod, rec]) => {
      if (cancelled) return
      const err = ing.error ?? stock.error ?? prod.error ?? rec.error
      if (err) return setLoadError(errorMessage(err))
      setLoadError(null)
      const dishIds = new Set((prod.data ?? []).map((p) => p.id))
      setData({
        ingredients: ing.data ?? [],
        stock: new Map((stock.data ?? []).map((r) => [r.ingredient_id, r])),
        dishes: prod.data ?? [],
        recipes: (rec.data ?? []).filter((r) => dishIds.has(r.product_id)),
      })
    })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  if (loadError) return <p className="error">{t(loadError)}</p>
  if (!data) return <p className="muted">{t('Đang tải…')}</p>

  return (
    <section className="report-stack">
      <IngredientList storeId={storeId} data={data} onChange={reload} toast={toast.success} />
      <RecipeEditor data={data} onChange={reload} toast={toast.success} />
      <small className="muted">{t('Tồn nguyên liệu tự giảm theo số phần món đã bán × định lượng trong công thức. Nhập nguyên liệu ở Kho hàng → Nhập hàng (gõ đúng tên nguyên liệu).')}</small>
    </section>
  )
}

function IngredientList({ storeId, data, onChange, toast }: { storeId: string; data: Data; onChange: () => void; toast: (m: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState({ name: '', unit: 'miếng', threshold: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', unit: '', threshold: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setError(null)
    const name = draft.name.trim()
    if (!name) return setError(t('Nhập tên nguyên liệu'))
    if (data.ingredients.some((i) => normalize(i.name.trim()) === normalize(name))) return setError(t('Nguyên liệu này đã có'))
    setBusy(true)
    const { error: e } = await supabase.from('ingredients').insert({
      store_id: storeId,
      name,
      unit: draft.unit.trim() || 'miếng',
      low_stock_threshold: Number(draft.threshold.replace(',', '.')) || 0,
    })
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setDraft({ name: '', unit: draft.unit, threshold: '' })
    toast(t('Đã thêm nguyên liệu {name}', { name }))
    onChange()
  }

  const save = async (id: string) => {
    setError(null)
    if (!edit.name.trim()) return setError(t('Nhập tên nguyên liệu'))
    setBusy(true)
    const { error: e } = await supabase
      .from('ingredients')
      .update({ name: edit.name.trim(), unit: edit.unit.trim() || 'miếng', low_stock_threshold: Number(edit.threshold.replace(',', '.')) || 0 })
      .eq('id', id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setEditing(null)
    onChange()
  }

  const hide = async (i: Ingredient) => {
    if (!window.confirm(t('Ẩn nguyên liệu {name}? Lịch sử nhập vẫn giữ, công thức đang dùng nó sẽ không còn tính.', { name: i.name }))) return
    const { error: e } = await supabase.from('ingredients').update({ is_active: false }).eq('id', i.id)
    if (e) return setError(errorMessage(e))
    onChange()
  }

  return (
    <div>
      <h2>{t('Nguyên liệu')}</h2>
      <div className="card form">
        <div className="filters">
          <label>
            {t('Tên nguyên liệu')}
            <input type="text" placeholder={t('Ví dụ: chả cốm, chả ốc')} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <label>
            {t('Đơn vị')}
            <input type="text" value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} />
          </label>
          <label>
            {t('Báo sắp hết khi ≤')}
            <input type="text" inputMode="decimal" value={draft.threshold} onChange={(e) => setDraft((d) => ({ ...d, threshold: e.target.value.replace(/[^0-9.,]/g, '') }))} />
          </label>
          <button type="button" className="primary" disabled={busy} onClick={add}>
            {t('Thêm nguyên liệu')}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {data.ingredients.length === 0 ? (
        <p className="muted">{t('Chưa có nguyên liệu nào. Thêm chả cốm, chả ốc, giò, nạm… rồi đặt công thức cho từng món.')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Nguyên liệu')}</th>
                <th>{t('Đơn vị')}</th>
                <th className="num">{t('Báo sắp hết khi ≤')}</th>
                <th className="num">{t('Còn lại')}</th>
                <th>{t('Trạng thái')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.ingredients.map((i) => {
                const st = data.stock.get(i.id)
                const onHand = st?.on_hand ?? 0
                const status = ingredientStatus(onHand, i.low_stock_threshold)
                const isEditing = editing === i.id
                return (
                  <tr key={i.id}>
                    <td>{isEditing ? <input type="text" value={edit.name} onChange={(e) => setEdit((d) => ({ ...d, name: e.target.value }))} /> : i.name}</td>
                    <td>{isEditing ? <input type="text" value={edit.unit} onChange={(e) => setEdit((d) => ({ ...d, unit: e.target.value }))} /> : i.unit}</td>
                    <td className="num">
                      {isEditing ? (
                        <input type="text" inputMode="decimal" value={edit.threshold} onChange={(e) => setEdit((d) => ({ ...d, threshold: e.target.value.replace(/[^0-9.,]/g, '') }))} />
                      ) : (
                        formatQty(i.low_stock_threshold)
                      )}
                    </td>
                    <td className="num">
                      <strong>{formatQty(onHand)}</strong>
                    </td>
                    <td>
                      <span className={`badge ${status === 'ok' ? 'badge-ok' : status === 'low' ? 'badge-warn' : 'badge-bad'}`}>
                        {status === 'ok' ? t('Ổn') : status === 'low' ? t('Sắp hết') : status === 'out' ? t('Hết') : t('Kiểm tra')}
                      </span>
                    </td>
                    <td className="actions">
                      {isEditing ? (
                        <>
                          <button type="button" className="link" disabled={busy} onClick={() => save(i.id)}>
                            {t('Lưu')}
                          </button>
                          <button type="button" className="link" onClick={() => setEditing(null)}>
                            {t('Huỷ')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setEditing(i.id)
                              setEdit({ name: i.name, unit: i.unit, threshold: String(i.low_stock_threshold) })
                            }}
                          >
                            {t('Sửa')}
                          </button>
                          <button type="button" className="link danger" onClick={() => hide(i)}>
                            {t('Ẩn')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RecipeEditor({ data, onChange, toast }: { data: Data; onChange: () => void; toast: (m: string) => void }) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [dishId, setDishId] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linesOf = (productId: string): Line[] =>
    data.recipes.filter((r) => r.product_id === productId).map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) }))
  const countOf = (productId: string) => data.recipes.filter((r) => r.product_id === productId).length
  const byId = new Map(data.ingredients.map((i) => [i.id, i]))

  const open = (id: string) => {
    setDishId(id)
    setLines(linesOf(id).length > 0 ? linesOf(id) : [{ ingredient_id: '', qty: '1' }])
    setError(null)
  }

  const shown = data.dishes.filter((d) => normalize(d.name).includes(normalize(search.trim())))
  const dish = data.dishes.find((d) => d.id === dishId)

  const save = async () => {
    if (!dish) return
    setError(null)
    const clean = normalizeRecipeLines(lines)
    setSaving(true)
    const { error: e } = await supabase.rpc('set_recipe', { p_product_id: dish.id, p_lines: clean })
    setSaving(false)
    if (e) return setError(errorMessage(e))
    toast(t('Đã lưu công thức {name}', { name: dish.name }))
    setDishId(null)
    onChange()
  }

  return (
    <div>
      <h2>{t('Công thức món')}</h2>
      <p className="muted">{t('Một phần món dùng bao nhiêu nguyên liệu, ví dụ "Bún đậu chả cốm" = 2 miếng chả cốm.')}</p>
      {data.ingredients.length === 0 ? (
        <p className="muted">{t('Thêm nguyên liệu trước rồi mới đặt công thức.')}</p>
      ) : (
        <div className="two-col">
          <div>
            <input type="search" className="discount-input" placeholder={t('Tìm món')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('Tìm món')} />
            <div className="table-wrap recipe-list">
              <table>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id} className={dishId === d.id ? 'row-editing' : undefined}>
                      <td>{d.name}</td>
                      <td className="num">
                        {countOf(d.id) > 0 ? <span className="badge badge-ok">{t('{count} nguyên liệu', { count: countOf(d.id) })}</span> : <span className="muted">{t('Chưa có')}</span>}
                      </td>
                      <td className="actions">
                        <button type="button" className="link" onClick={() => open(d.id)}>
                          {countOf(d.id) > 0 ? t('Sửa') : t('Đặt công thức')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td className="muted">{t('Không tìm thấy món.')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            {!dish ? (
              <p className="muted">{t('Chọn một món ở bên trái để đặt công thức.')}</p>
            ) : (
              <div className="card form editing">
                <strong>{dish.name}</strong>
                {lines.map((l, i) => (
                  <div key={i} className="recipe-line">
                    <select value={l.ingredient_id} aria-label={t('Nguyên liệu')} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, ingredient_id: e.target.value } : x)))}>
                      <option value="">{t('Chọn nguyên liệu')}</option>
                      {data.ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={t('Định lượng')}
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/[^0-9.,]/g, '') } : x)))}
                    />
                    <span className="muted">{byId.get(l.ingredient_id)?.unit ?? ''}</span>
                    <button type="button" className="remove" aria-label={t('Xoá dòng {n}', { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="expense-add" onClick={() => setLines((ls) => [...ls, { ingredient_id: '', qty: '1' }])}>
                  + {t('Thêm nguyên liệu')}
                </button>
                <label className="field">
                  {t('Sao chép công thức từ món khác')}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setLines(linesOf(e.target.value))
                    }}
                  >
                    <option value="">{t('Chọn món…')}</option>
                    {data.dishes.filter((d) => d.id !== dish.id && countOf(d.id) > 0).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error && <p className="error">{error}</p>}
                <div className="expense-footer">
                  <button type="button" onClick={() => setDishId(null)}>
                    {t('Đóng')}
                  </button>
                  <button type="button" className="primary" disabled={saving} onClick={save}>
                    {saving ? t('Đang lưu…') : t('Lưu công thức')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
