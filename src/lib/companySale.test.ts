import { describe, expect, it } from 'vitest'
import { allocateSetTotal, allocatedTotal, setTotal } from './companySale'

describe('kênh Công ty: chia tiền set mix', () => {
  it('tổng tiền = số set × giá 1 set', () => {
    expect(setTotal(10, 50000)).toBe(500000)
  })

  it('chia theo giá tại quầy × số hũ, tổng khớp', () => {
    // 10 set × (2 cacao + 1 truyền thống); cacao 15.000, truyền thống 12.000 tại quầy
    const lines = [
      { productId: 'cc', qty: 20, weight: 15000 },
      { productId: 'tt', qty: 10, weight: 12000 },
    ]
    const prices = allocateSetTotal(400000, lines)
    // 300k : 120k → 14.285,71 và 11.428,57 (tổng 399.999,90); bù 0,10 đ vào truyền thống (10 hũ × 0,01)
    expect(prices.get('cc')).toBe(14285.71)
    expect(prices.get('tt')).toBe(11428.58)
    expect(allocatedTotal(lines, prices)).toBe(400000)
  })

  it('chia hết thì tổng khớp tuyệt đối', () => {
    const lines = [
      { productId: 'cc', qty: 20, weight: 15000 },
      { productId: 'mt', qty: 10, weight: 15000 },
    ]
    const prices = allocateSetTotal(450000, lines)
    expect(prices.get('cc')).toBe(15000)
    expect(prices.get('mt')).toBe(15000)
    expect(allocatedTotal(lines, prices)).toBe(450000)
  })

  it('bù làm tròn vào dòng ít hũ nhất', () => {
    const lines = [
      { productId: 'a', qty: 1, weight: 10000 },
      { productId: 'b', qty: 3, weight: 10000 },
      { productId: 'c', qty: 3, weight: 10000 },
    ]
    const prices = allocateSetTotal(100000, lines)
    expect(allocatedTotal(lines, prices)).toBe(100000)
  })

  it('món chưa có giá tại quầy: nếu tất cả 0 thì chia đều theo hũ; bỏ dòng số lượng 0', () => {
    const lines = [
      { productId: 'a', qty: 4, weight: 0 },
      { productId: 'b', qty: 6, weight: 0 },
      { productId: 'z', qty: 0, weight: 9000 },
    ]
    const prices = allocateSetTotal(100000, lines)
    expect(prices.get('a')).toBe(10000)
    expect(prices.get('b')).toBe(10000)
    expect(prices.has('z')).toBe(false)
  })

  it('đơn trống không chia', () => {
    expect(allocateSetTotal(100000, []).size).toBe(0)
  })
})
