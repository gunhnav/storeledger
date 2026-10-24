import { describe, expect, it } from 'vitest'
import { lineText, recipeMargin, usageFor } from './dishRecipes'

describe('định lượng món', () => {
  it('hiện số lượng, đơn vị và tên', () => {
    expect(lineText({ ingredient: 'Đậu', qty: 7, unit: 'miếng' })).toBe('7 miếng Đậu')
    expect(lineText({ ingredient: 'Bún', qty: 10, unit: null })).toBe('10 Bún')
    expect(lineText({ ingredient: 'Rau ăn kèm', qty: null, unit: null })).toBe('Rau ăn kèm')
  })

  it('lãi gộp và biên lãi', () => {
    expect(recipeMargin(60000, 30049)).toEqual({ profit: 29951, pct: 29951 / 60000 })
    expect(recipeMargin(60000, null)).toBeNull()
  })

  it('cộng định lượng theo số phần, cộng dồn nguyên liệu trùng, bỏ dòng không định lượng', () => {
    const u = usageFor([{ ingredient: 'Bún', qty: 20 }, { ingredient: 'Bún', qty: 10 }, { ingredient: 'Rau ăn kèm', qty: null }], 3)
    expect([...u]).toEqual([['Bún', 90]])
  })
})
