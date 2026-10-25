import { describe, expect, it } from 'vitest'
import { preorderPayload, cartCount, cartSingles, cartSummary, lineTitle, setSingleQty, singleQty, unitOf, EMPTY_CUSTOMER, addSet, menuLines, setPriceHints, customerIssues, transferNote, cleanFloor, validDomain, validFloor, vietQrUrl, cartJars, cartSets, cartTotal, changeMix, flavorColors, flavorImage, flavorNote, mixLabel, orderMessage, refreshCart, selectable, setLineQty, setPrice, zaloLink, hangoutEmail, type MenuItem } from './storefront'

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
    expect(next.map((l) => (l.kind === 'set' ? l.mix : null))).toEqual([{ tt: 4 }])
    expect(refreshCart(lines, items, { set_prices: [{ size: 4 as const, product_id: null, price: 40000 }] }).map((l) => l.unitPrice)).toEqual([40000, 40000])
  })
  it('nội dung đơn gửi Zalo', () => {
    const lines = addSet([], 4, { tt: 2, pm: 2 }, 2, items, noFixed)
    const head = ['Xin chào Hogi, mình muốn đặt trước:', '- 2 set 4 hũ (2 Truyền thống + 2 Phô mai): 108.000đ', 'Tổng: 108.000đ (2 set (8 hũ))']
    expect(orderMessage('Hogi', lines, items, { name: ' An ' })).toBe([...head, 'Tên: An'].join('\n'))
    const full = { name: 'An', domain: 'An.Nguyen2', floor: 'tầng 6', payment: 'cash' as const }
    expect(orderMessage('Hogi', lines, items, full, true)).toBe([...head, 'Tên: An', 'Domain: an.nguyen2', 'Tầng: 6', 'Thanh toán: tiền mặt khi nhận'].join('\n'))
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
    expect(flavorImage('Hũ làm quen 110gr')).toBe('/shop/flavor-hy-lap.svg')
    expect(flavorImage('Hũ tri kỷ 400gr')).toBe('/shop/flavor-hy-lap-400.svg')
    expect(flavorImage('Nước whey 220ml')).toBe('/shop/flavor-whey.svg')
    expect(flavorImage('Dâu tằm')).toBeNull()
    expect(flavorNote('Matcha')).toBe('Thơm dịu vị trà xanh')
    expect(flavorNote('Dâu tằm')).toBeNull()
    expect(flavorColors('Matcha')[0]).toMatch(/^#/)
  })
})

describe('thông tin khách và chuyển khoản', () => {
  it('domain và tầng', () => {
    expect(validDomain('user.test')).toBe(true)
    expect(validDomain(' user.test@example.com ')).toBe(true)
    expect(validDomain('hương')).toBe(false)
    expect(cleanFloor('tầng 6')).toBe('6')
    expect(cleanFloor('F12')).toBe('12')
    expect(validFloor('b1')).toBe(true)
    expect(validFloor('tầng sáu mươi')).toBe(false)
  })
  it('báo thiếu tên, domain, tầng', () => {
    expect(Object.keys(customerIssues(EMPTY_CUSTOMER)).sort()).toEqual(['domain', 'floor', 'name'])
    expect(customerIssues({ ...EMPTY_CUSTOMER, name: 'Hường', domain: 'huong.vu3', floor: '6' })).toEqual({})
  })
  it('nội dung chuyển khoản dạng domain - F tầng', () => {
    expect(transferNote(' Huong.Vu3 ', 'tầng 6')).toBe('huong.vu3 - F6')
  })
  it('hangoutEmail ưu tiên email của quán nếu có, mặc định là domain', () => {
    expect(hangoutEmail('user.name', 'contact@store.vn')).toBe('contact@store.vn')
    expect(hangoutEmail('huong.vu3')).toBe('huong.vu3')
  })
  it('link QR VietQR có số tiền, nội dung và tên chủ tài khoản', () => {
    const url = vietQrUrl({ code: 'TCB', account: '19038457119011', holder: 'NGO THI CAM THY' }, 108000.4, 'huong.vu3 - F6')
    expect(url.startsWith('https://img.vietqr.io/image/TCB-19038457119011-compact2.png?')).toBe(true)
    const q = new URL(url).searchParams
    expect([q.get('amount'), q.get('addInfo'), q.get('accountName')]).toEqual(['108000', 'huong.vu3 - F6', 'NGO THI CAM THY'])
  })
})

describe('món bán lẻ (sữa chua Hy Lạp)', () => {
  const greek = [
    { id: 'lq', name: 'Hũ làm quen 110gr', category: 'Sữa chua Hy Lạp', price: 30000, mode: 'single' as const },
    { id: 'wh', name: 'Nước whey 220ml', category: 'Sữa chua Hy Lạp', price: 10000, mode: 'single' as const },
  ]
  const menu = [...items, ...greek]
  it('đặt, đổi, bỏ số lượng món lẻ; không gộp vào set', () => {
    let lines = setSingleQty([], greek[0], 2)
    lines = setSingleQty(lines, greek[1], 3)
    lines = setSingleQty(lines, greek[0], 1)
    expect(singleQty(lines, 'lq')).toBe(1)
    expect(lines).toHaveLength(2)
    expect(setSingleQty(lines, greek[1], 0)).toHaveLength(1)
  })
  it('đơn trộn set và món lẻ: tổng tiền, đếm, tóm tắt, nội dung Zalo', () => {
    let lines = addSet([], 4, { tt: 2, pm: 2 }, 1, menu, noFixed)
    lines = setSingleQty(lines, greek[0], 2)
    lines = setSingleQty(lines, greek[1], 1)
    expect(cartTotal(lines)).toBe(54000 + 60000 + 10000)
    expect([cartSets(lines), cartJars(lines), cartSingles(lines), cartCount(lines)]).toEqual([1, 4, 3, 4])
    expect(cartSummary(lines)).toBe('1 set (4 hũ) + 3 món lẻ')
    const msg = orderMessage('Hogi', lines, menu).split('\n')
    expect(msg).toContain('- 2 hũ Hũ làm quen 110gr: 60.000đ')
    expect(msg).toContain('- 1 chai Nước whey 220ml: 10.000đ')
    expect(lineTitle(lines[2], menu)).toEqual({ title: 'Nước whey 220ml', detail: 'Bán lẻ', unit: 'chai' })
  })
  it('món lẻ bị gỡ khỏi thực đơn thì bỏ khỏi đơn, giá mới thì cập nhật', () => {
    const lines = setSingleQty([], greek[0], 2)
    expect(refreshCart(lines, items, noFixed)).toEqual([])
    expect(refreshCart(lines, [{ ...greek[0], price: 35000 }], noFixed)[0].unitPrice).toBe(35000)
  })
  it('đơn vị bán lẻ', () => {
    expect(unitOf('Nước whey 220ml')).toBe('chai')
    expect(unitOf('Hũ tri kỷ 400gr')).toBe('hũ')
  })
})

describe('đơn gửi lên máy chủ', () => {
  it('chỉ gửi món + số lượng (không gửi giá), làm sạch domain và tầng', () => {
    let lines = addSet([], 4, { tt: 2, pm: 2 }, 1, items, noFixed)
    lines = setSingleQty(lines, { id: 'lq', name: 'Hũ làm quen', category: 'Hy Lạp', price: 30000, mode: 'single' }, 2)
    const body = preorderPayload(lines, { name: ' Khách hàng ', domain: 'customer.order@example.com', floor: 'tầng 6', payment: 'cash' })
    expect(body).toEqual({
      name: 'Khách hàng', domain: 'customer.order', floor: '6', payment: 'cash',
      lines: [{ kind: 'set', size: 4, mix: { tt: 2, pm: 2 }, qty: 1 }, { kind: 'single', product_id: 'lq', qty: 2 }],
    })
    expect(JSON.stringify(body)).not.toContain('unitPrice')
  })
  it('tầng phải nằm trong danh sách giao', () => {
    const c = { ...EMPTY_CUSTOMER, name: 'A', domain: 'a.b', floor: '10' }
    expect(customerIssues(c, ['6', '7', '8', '9', '11', '12']).floor).toBe('Chỉ giao tầng 6, 7, 8, 9, 11, 12')
    expect(customerIssues({ ...c, floor: 'F11' }, ['6', '11'])).toEqual({})
    expect(customerIssues({ ...c, floor: '' }, ['6']).floor).toBe('Chọn tầng')
  })
})
