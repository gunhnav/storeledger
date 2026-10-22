import { describe, expect, it } from 'vitest'
import { buildInsights, hourBuckets, pctChange, presetRange, previousRange } from './bundauReport'
import type { BundauReport, IngredientStockRow } from '../types/database'

const report = (over: Partial<BundauReport> = {}): BundauReport => ({
  totals: { orders: 10, gross: 1000000, commission: 0, discount: 0, portions: 20 },
  days: [],
  channels: [],
  top: [],
  hours: [],
  ...over,
})
const ing = (over: Partial<IngredientStockRow>): IngredientStockRow => ({
  ingredient_id: 'i', name: 'Chả cốm', unit: 'miếng', low_stock_threshold: 10, received: 100, used: 10, on_hand: 90, used_recent: 7, last_receipt: null, ...over,
})
const base = { previous: null, expenses: 0, ingredientExpenses: 0, ingredients: [], recentDays: 7, drinks: [], fmt: (v: number) => String(v) }

describe('khoảng ngày', () => {
  it('các lựa chọn nhanh', () => {
    expect(presetRange('today', '2026-10-22')).toEqual({ from: '2026-10-22', to: '2026-10-22' })
    expect(presetRange('7d', '2026-10-22')).toEqual({ from: '2026-10-16', to: '2026-10-22' })
    expect(presetRange('month', '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-22' })
    expect(presetRange('lastMonth', '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('kỳ trước cùng số ngày, liền kề', () => {
    expect(previousRange({ from: '2026-10-16', to: '2026-10-22' })).toEqual({ from: '2026-10-09', to: '2026-10-15' })
    expect(previousRange({ from: '2026-10-22', to: '2026-10-22' })).toEqual({ from: '2026-10-21', to: '2026-10-21' })
    expect(previousRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-08-31', to: '2026-09-30' })
  })
})

describe('so với kỳ trước', () => {
  it('phần trăm thay đổi, không so được khi kỳ trước bằng 0', () => {
    expect(pctChange(150, 100)).toBeCloseTo(0.5)
    expect(pctChange(50, 100)).toBeCloseTo(-0.5)
    expect(pctChange(50, 0)).toBeNull()
  })
})

describe('giờ đông khách', () => {
  it('luôn đủ 8h-21h, mở rộng khi có đơn ngoài khung', () => {
    const b = hourBuckets([{ hour: 12, orders: 5, gross: 100 }])
    expect(b[0].hour).toBe(8)
    expect(b.at(-1)?.hour).toBe(21)
    expect(b.find((x) => x.hour === 12)?.orders).toBe(5)
    const wide = hourBuckets([{ hour: 6, orders: 1, gross: 1 }, { hour: 23, orders: 2, gross: 2 }])
    expect(wide[0].hour).toBe(6)
    expect(wide.at(-1)?.hour).toBe(23)
  })
})

describe('gợi ý cho chủ quán', () => {
  it('nguyên liệu hết và sắp hết theo tốc độ bán', () => {
    const out = buildInsights({ ...base, report: report(), ingredients: [ing({ name: 'Chả ốc', on_hand: 0 }), ing({ name: 'Giò', on_hand: 12, used_recent: 70 })] })
    expect(out.some((x) => x.key.startsWith('Nguyên liệu đã hết') && String(x.params?.list).includes('Chả ốc'))).toBe(true)
    expect(out.some((x) => x.key.startsWith('Sắp hết trong 1-2 ngày') && String(x.params?.list).includes('Giò'))).toBe(true)
  })

  it('nguyên liệu đã nhập nhưng chưa có công thức', () => {
    const out = buildInsights({ ...base, report: report(), ingredients: [ing({ name: 'Nem', used: 0 })] })
    expect(out.some((x) => x.key.startsWith('Chưa có món nào dùng'))).toBe(true)
  })

  it('không có đơn thì chỉ báo chưa có đơn', () => {
    const out = buildInsights({ ...base, report: report({ totals: { orders: 0, gross: 0, commission: 0, discount: 0, portions: 0 } }) })
    expect(out.at(-1)?.key).toBe('Chưa có đơn nào trong kỳ này.')
  })

  it('doanh thu tăng / giảm mạnh so với kỳ trước', () => {
    const up = buildInsights({ ...base, report: report(), previous: report({ totals: { orders: 5, gross: 500000, commission: 0, discount: 0, portions: 9 } }) })
    expect(up.find((x) => x.key.startsWith('Doanh thu tăng'))?.params?.pct).toBe(100)
    const down = buildInsights({ ...base, report: report(), previous: report({ totals: { orders: 20, gross: 2000000, commission: 0, discount: 0, portions: 40 } }) })
    expect(down.find((x) => x.key.startsWith('Doanh thu giảm'))?.params?.pct).toBe(50)
  })

  it('cảnh báo tiền nguyên liệu quá cao, giảm giá nhiều, đối tác chiếm nhiều', () => {
    const out = buildInsights({
      ...base,
      report: report({
        totals: { orders: 10, gross: 1000000, commission: 100000, discount: 150000, portions: 20 },
        channels: [{ channel: 'shopeefood', orders: 5, gross: 500000, commission: 100000 }],
      }),
      ingredientExpenses: 600000,
    })
    expect(out.some((x) => x.key.startsWith('Tiền nguyên liệu chiếm'))).toBe(true)
    expect(out.some((x) => x.key.startsWith('Đã giảm giá'))).toBe(true)
    expect(out.find((x) => x.key.startsWith('Kênh đối tác'))?.tone).toBe('warn')
  })

  it('mọi thứ ổn thì báo ổn', () => {
    const out = buildInsights({ ...base, report: report({ top: [{ name: 'Bún đậu thịt', qty: 8, revenue: 400000 }] }) })
    expect(out.at(-1)?.tone).toBe('good')
  })

  it('đồ uống hết hoặc sắp hết', () => {
    const out = buildInsights({ ...base, report: report(), drinks: [{ name: 'Coca', onHand: 2, threshold: 3 }, { name: 'Pepsi', onHand: 20, threshold: 3 }] })
    expect(out.some((x) => x.key.startsWith('Đồ uống sắp hết') && String(x.params?.list) === 'Coca')).toBe(true)
  })
})
