import { describe, expect, it } from 'vitest'
import { EMPTY_CUSTOMER, addSet, menuLines, setPriceHints, customerIssues, transferMemo, validPhone, vietQrUrl, cartJars, cartSets, cartTotal, changeMix, flavorColors, flavorImage, flavorNote, mixLabel, orderMessage, refreshCart, selectable, setLineQty, setPrice, zaloLink, type MenuItem } from './storefront'

const item = (id: string, name: string, price: number | null): MenuItem => ({ id, name, category: null, price })
const items = [item('tt', 'Truyền thống', 12000), item('pm', 'Phô mai', 15000), item('mc', 'Matcha', 15000), item('x', 'Vị chưa có giá', null)]
const noFixed = { set_prices: [] }

describe('giá set', () => {
  const tt = item('tt', 'Truyền thống', 12000)
  const flan = { ...item('fl', 'Bánh flan', 10000), category: 'Bánh flan' }
  const yogurt = [item('tt', 'Truyền thống', 12000), item('pm', 'Phô mai', 15000), item('mc', 'Matcha', 15000)].map((i) => ({ ...i, category: 'Sữa chua' }))
  const menu = [...yogurt, flan]
  const rules = {
    set_prices: [
      { size: 4 as const, product_id: 'tt', price: 50000 },
      { size: 6 as const, product_id: 'tt', price: 70000 },
      { size: 4 as const, product_id: null, price: 55000 },
      { size: 6 as const, product_id: null, price: 80000 },
    ],
  }

  it('set toàn Truyền thống dùng giá riêng, set mix vị hoặc vị khác dùng giá mix', () => {
    expect(setPrice(4, { tt: 4 }, menu, rules)).toBe(50000)
    expect(setPrice(6, { tt: 6 }, menu, rules)).toBe(70000)
    expect(setPrice(4, { tt: 2, pm: 2 }, menu, rules)).toBe(55000)
    expect(setPrice(6, { tt: 1, pm: 2, mc: 3 }, menu, rules)).toBe(80000)
    expect(setPrice(4, { pm: 4 }, menu, rules)).toBe(55000)
  })
  it('bánh flan (dòng một vị) tính theo từng hũ, không dính giá mix', () => {
    expect(setPrice(4, { fl: 4 }, menu, rules)).toBe(40000)
    expect(setPrice(6, { fl: 6 }, menu, rules)).toBe(60000)
  })
  it('chưa có bảng giá thì cộng giá từng hũ', () => {
    expect(setPrice(4, { tt: 2, pm: 2 }, menu, { set_prices: [] })).toBe(54000)
    expect(setPrice(4, {}, menu, rules)).toBeNull()
  })
  it('vị chưa có giá mà không có giá set thì chưa tính được', () => {
    const x = item('x', 'Vị chưa có giá', null)
    expect(setPrice(4, { tt: 3, x: 1 }, [tt, x], { set_prices: [] })).toBeNull()
    expect(setPrice(4, { x: 4 }, [x], { set_prices: [{ size: 4, product_id: 'x', price: 60000 }] })).toBe(60000)
    expect(selectable(x, 4, { set_prices: [] })).toBe(false)
    expect(selectable(x, 4, { set_prices: [{ size: 4, product_id: null, price: 55000 }] })).toBe(true)
  })
  it('nhóm các dòng món và gợi ý giá cho nút chọn cỡ set', () => {
    expect(menuLines(menu)).toEqual(['Sữa chua', 'Bánh flan'])
    expect(setPriceHints(4, yogurt, rules)).toEqual([{ label: 'Truyền thống', price: 50000 }, { label: 'Mix vị', price: 55000 }])
    expect(setPriceHints(6, [flan], rules)).toEqual([{ label: null, price: 60000 }])
  })
  it('không trộn hai dòng món trong một set', () => {
    expect(addSet([], 4, { tt: 2, fl: 2 }, 1, menu, rules)).toEqual([])
  })
})

describe('soạn set', () => {
  it('chọn vị không âm và tổng không vượt cỡ set', () => {
    let mix = changeMix({}, 'tt', 1, 4)
    mix = changeMix(mix, 'tt', 5, 4)
    expect(mix).toEqual({ tt: 4 })
    expect(changeMix(mix, 'pm', 1, 4)).toEqual({ tt: 4 })
    expect(changeMix(mix, 'tt', -9, 4)).toEqual({})
  })
  it('mô tả set theo thứ tự thực đơn', () => {
    expect(mixLabel({ pm: 2, tt: 2 }, items)).toBe('2 Truyền thống + 2 Phô mai')
  })
})

describe('giỏ hàng theo set', () => {
  it('chỉ thêm set đủ hũ, set giống hệt thì cộng dồn', () => {
    expect(addSet([], 4, { tt: 3 }, 1, items, noFixed)).toEqual([])
    const a = addSet([], 4, { tt: 2, pm: 2 }, 1, items, noFixed)
    expect(a).toHaveLength(1)
    const b = addSet(a, 4, { pm: 2, tt: 2 }, 2, items, noFixed)
    expect(b).toHaveLength(1)
    expect(b[0].qty).toBe(3)
    expect(addSet(b, 6, { tt: 6 }, 1, items, noFixed)).toHaveLength(2)
  })
  it('tổng tiền, số set, số hũ; đổi số set và bỏ dòng', () => {
    let lines = addSet([], 4, { tt: 2, pm: 2 }, 2, items, noFixed)
    lines = addSet(lines, 6, { mc: 6 }, 1, items, noFixed)
    expect([cartTotal(lines), cartSets(lines), cartJars(lines)]).toEqual([2 * 54000 + 90000, 3, 14])
    expect(setLineQty(lines, lines[0].key, 0)).toHaveLength(1)
    expect(setLineQty(lines, lines[0].key, 500)[0].qty).toBe(99)
  })
  it('bỏ dòng có vị không còn trên thực đơn và cập nhật giá', () => {
    const lines = addSet(addSet([], 4, { tt: 2, pm: 2 }, 1, items, noFixed), 4, { tt: 4 }, 1, items, noFixed)
    const next = refreshCart(lines, items.filter((i) => i.id !== 'pm'), noFixed)
    expect(next.map((l) => l.mix)).toEqual([{ tt: 4 }])
    expect(refreshCart(lines, items, { set_prices: [{ size: 4 as const, product_id: null, price: 40000 }] }).map((l) => l.unitPrice)).toEqual([40000, 40000])
  })
  it('nội dung đơn gửi Zalo', () => {
    const lines = addSet([], 4, { tt: 2, pm: 2 }, 2, items, noFixed)
    const head = ['Xin chào Hogi, mình muốn đặt trước:', '- 2 set 4 hũ (2 Truyền thống + 2 Phô mai): 108.000đ', 'Tổng: 108.000đ (2 set, 8 hũ)']
    expect(orderMessage('Hogi', lines, items, { name: ' An ', note: 'Giao 9h' })).toBe([...head, 'Tên: An', 'Ghi chú: Giao 9h'].join('\n'))
    const full = { name: 'An', phone: '0901 234 567', address: '12 Lê Lợi', note: '', payment: 'cash' as const }
    expect(orderMessage('Hogi', lines, items, full, true)).toBe([...head, 'Tên: An', 'SĐT: 0901 234 567', 'Địa chỉ: 12 Lê Lợi', 'Thanh toán: tiền mặt khi nhận'].join('\n'))
    expect(orderMessage('Hogi', lines, items, full, false)).not.toContain('Thanh toán')
    expect(orderMessage('Hogi', lines, items, {}, false, 'HG262987K3Q').split('\n')[0]).toBe('Xin chào Hogi, mình muốn đặt trước (mã đơn HG262987K3Q):')
  })
  it('link Zalo đổi +84 thành 0', () => {
    expect(zaloLink('+84 901 234 567')).toBe('https://zalo.me/0901234567')
  })
})

describe('hình và mô tả theo vị', () => {
  it('nhận vị không phân biệt dấu và hoa thường', () => {
    expect(flavorImage('Nếp cẩm')).toBe('/shop/flavor-nep-cam.svg')
    expect(flavorImage('PHÔ MAI')).toBe('/shop/flavor-pho-mai.svg')
    expect(flavorImage('Dâu tằm')).toBeNull()
    expect(flavorNote('Matcha')).toBe('Thơm dịu vị trà xanh')
    expect(flavorNote('Dâu tằm')).toBeNull()
    expect(flavorColors('Matcha')[0]).toMatch(/^#/)
  })
})

describe('thông tin khách và chuyển khoản', () => {
  it('kiểm tra số điện thoại', () => {
    expect(validPhone('0901 234 567')).toBe(true)
    expect(validPhone('+84 901 234 567')).toBe(true)
    expect(validPhone('12345')).toBe(false)
    expect(validPhone('09012345678901')).toBe(false)
  })
  it('báo thiếu tên, số điện thoại, địa chỉ', () => {
    expect(Object.keys(customerIssues(EMPTY_CUSTOMER)).sort()).toEqual(['address', 'name', 'phone'])
    expect(customerIssues({ ...EMPTY_CUSTOMER, name: 'An', phone: '123', address: 'x' }).phone).toBe('Số điện thoại chưa đúng')
    expect(customerIssues({ ...EMPTY_CUSTOMER, name: 'An', phone: '0901234567', address: '12 Lê Lợi' })).toEqual({})
  })
  it('link QR VietQR có số tiền, nội dung và tên chủ tài khoản', () => {
    const url = vietQrUrl({ code: 'TCB', account: '19038457119011', holder: 'NGO THI CAM THY' }, 108000.4, 'Hogi 0901234567')
    expect(url.startsWith('https://img.vietqr.io/image/TCB-19038457119011-compact2.png?')).toBe(true)
    const q = new URL(url).searchParams
    expect([q.get('amount'), q.get('addInfo'), q.get('accountName')]).toEqual(['108000', 'Hogi 0901234567', 'NGO THI CAM THY'])
  })
  it('nội dung chuyển khoản gồm tên quán và số điện thoại, tối đa 50 ký tự', () => {
    expect(transferMemo('Hogi Food', '0901 234 567')).toBe('Hogi Food 0901234567')
    expect(transferMemo('x'.repeat(80), '0901234567').length).toBe(50)
  })
})
