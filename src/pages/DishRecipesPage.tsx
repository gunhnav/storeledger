import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { errorMessage, formatVND } from '../lib/format'
import { lineText, recipeMargin } from '../lib/dishRecipes'
import type { DishRecipe, DishRecipeLine } from '../types/database'

// Định lượng nguyên vật liệu từng món (chỉ admin, quán Bún đậu). Chỉ xem; dữ liệu dùng để tính tồn kho nguyên vật liệu sau này.
export function DishRecipesPage() {
  const { current } = useStore()
  return current ? <DishRecipes key={current.id} storeId={current.id} /> : null
}

function DishRecipes({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const [data, setData] = useState<{ recipes: DishRecipe[]; lines: DishRecipeLine[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('dish_recipes')
      .select('*')
      .eq('store_id', storeId)
      .order('sort_order')
      .then(async ({ data: recipes, error: e }) => {
        if (cancelled) return
        if (e) return setError(errorMessage(e))
        const ids = recipes.map((r) => r.id)
        const lines = ids.length ? await supabase.from('dish_recipe_lines').select('*').in('recipe_id', ids).order('sort_order') : { data: [], error: null }
        if (cancelled) return
        if (lines.error) return setError(errorMessage(lines.error))
        setData({ recipes, lines: lines.data ?? [] })
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (error) return <p className="error">{t(error)}</p>
  if (!data) return <p className="muted">{t('Đang tải…')}</p>
  if (data.recipes.length === 0) return <p className="muted">{t('Chưa có định lượng món nào.')}</p>

  return (
    <section>
      <h2>{t('Định lượng nguyên vật liệu từng món')}</h2>
      <p className="muted">{t('Dùng để tính tồn kho nguyên vật liệu từ số phần đã bán.')}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('Món')}</th>
              <th>{t('Nguyên vật liệu một phần')}</th>
              <th className="num">{t('Giá bán')}</th>
              <th className="num">{t('Giá vốn')}</th>
              <th className="num">{t('Lời')}</th>
            </tr>
          </thead>
          <tbody>
            {data.recipes.map((r) => {
              const lines = data.lines.filter((l) => l.recipe_id === r.id)
              const base = lines.filter((l) => !l.is_extra)
              const extra = lines.filter((l) => l.is_extra)
              const margin = recipeMargin(Number(r.sale_price), r.unit_cost === null ? null : Number(r.unit_cost))
              return (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {r.item_codes.length > 0 && <small className="muted"> {r.item_codes.join(', ')}</small>}
                  </td>
                  <td>
                    {base.map(lineText).join(', ')}
                    {extra.length > 0 && <strong> + {extra.map(lineText).join(' + ')}</strong>}
                  </td>
                  <td className="num">{formatVND(Number(r.sale_price))}</td>
                  <td className="num">{r.unit_cost === null ? '—' : formatVND(Number(r.unit_cost))}</td>
                  <td className="num">{margin ? `${formatVND(margin.profit)} (${Math.round(margin.pct * 100)}%)` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
