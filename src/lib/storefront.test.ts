import { describe, expect, it } from 'vitest'
import { addToCart, canOrder, cartCount, cartTotal, flavorColors, orderMessage, pruneCart, setCartQty, zaloLink, type MenuItem } from './storefront'

const item = (id: string, name: string, price: number | null, status: MenuItem['status'] = 'in_stock'): MenuItem => ({ id, name, category: null, price, status })

describe('giỏ hàng trang bán hàng', () => {
  it('chỉ đặt được món còn hàng và có giá', () => {
    expect(canOrder(item('a', 'A', 12000))).toBe(true)
    expect(canOrder(item('a', 'A', 12000, 'low'))).toBe(true)
    expect(canOrder(item('a', 'A', 12000, 'out'))).toBe(false)
    expect(canOrder(item('a', 'A', null))).toBe(false)
  })

  it('thêm cộng dồn, hết hàng thì không thêm, tối đa 99', () => {
    let cart = addToCart([], item('a', 'Matcha', 15000), 2)
    cart = addToCart(cart, item('a', 'Matcha', 15000), 3)
    expect(cart).toEqual([{ id: 'a', name: 'Matcha', price: 15000, qty: 5 }])
    expect(addToCart(cart, item('b', 'Phô mai', 15000, 'out'), 1)).toEqual(cart)
    expect(addToCart(cart, item('a', 'Matcha', 15000), 500)[0].qty).toBe(99)
  })

  it('đổi số lượng và bỏ dòng khi về 0', () => {
    const cart = addToCart([], item('a', 'A', 10000), 2)
    expect(setCartQty(cart, 'a', 4)[0].qty).toBe(4)
    expect(setCartQty(cart, 'a', 0)).toEqual([])
  })

  it('tổng tiền và số hũ', () => {
    const cart = addToCart(addToCart([], item('a', 'A', 12000), 2), item('b', 'B', 15000), 1)
    expect(cartTotal(cart)).toBe(39000)
    expect(cartCount(cart)).toBe(3)
  })

  it('bỏ món vừa hết hàng khỏi giỏ khi thực đơn cập nhật', () => {
    const cart = addToCart(addToCart([], item('a', 'A', 12000), 1), item('b', 'B', 15000), 1)
    expect(pruneCart(cart, [item('a', 'A', 12000), item('b', 'B', 15000, 'out')]).map((l) => l.id)).toEqual(['a'])
  })
})

describe('đơn gửi qua Zalo', () => {
  const cart = [{ id: 'a', name: 'Matcha', price: 15000, qty: 2 }]
  it('nội dung đơn có món, tổng, tên và ghi chú', () => {
    const msg = orderMessage('Hogi Food', cart, { name: ' An ', note: 'giao 5h' })
    expect(msg).toContain('Xin chào Hogi Food')
    expect(msg).toContain('- Matcha x2: 30.000đ')
    expect(msg).toContain('Tổng: 30.000đ')
    expect(msg).toContain('Tên: An')
    expect(msg).toContain('Ghi chú: giao 5h')
  })
  it('link Zalo chỉ giữ chữ số, đổi +84 về 0', () => {
    expect(zaloLink('0777 725 471')).toBe('https://zalo.me/0777725471')
    expect(zaloLink('+84 777 725 471')).toBe('https://zalo.me/0777725471')
  })
})

describe('màu theo vị', () => {
  it('nhận vị có dấu và mặc định', () => {
    expect(flavorColors('Matcha')[1]).toBe('#8fb86a')
    expect(flavorColors('Nếp cẩm')[1]).toBe('#8a5a94')
    expect(flavorColors('Vị lạ')).toHaveLength(2)
  })
})
