// Trang bán hàng công khai (/hogi, /shop/<mã quán>): ĐẶT TRƯỚC theo set (4 hoặc 6 hũ, tự chọn vị) như kênh Công ty.
// Không lấy tồn kho: ai đặt gì nhận đó. Giỏ hàng là các dòng set; nội dung đơn gửi qua Zalo.

export const SET_SIZES = [4, 6] as const
export type SetSize = (typeof SET_SIZES)[number]

export type MenuItem = { id: string; name: string; category: string | null; price: number | null }
export type PublicBank = { code: string; account: string; holder: string }
// QR thanh toán gốc của quán (chuỗi EMVCo, ví dụ QR Góp Quỹ MoMo): trang tự thêm số tiền, số hoá đơn, nội dung
export type PublicPay = { payload: string; label: string | null; holder: string }
// Bảng giá set: product_id có giá trị = set chỉ gồm vị đó; null = giá mặc định cho set mix vị của dòng món có từ 2 vị trở lên
export type SetPriceRule = { size: SetSize; product_id: string | null; price: number }
export type PublicStore = {
  name: string
  phone: string | null
  tagline: string | null
  set_prices: SetPriceRule[]
  // Thông tin chuyển khoản (chỉ có khi quán đã nhập đủ mã ngân hàng, số tài khoản, chủ tài khoản)
  bank: PublicBank | null
  pay: PublicPay | null
}
export type PublicMenu = { store: PublicStore; items: MenuItem[] }

// Số hũ từng vị trong một set: { <mã món>: số hũ }
export type Mix = Record<string, number>
export type SetLine = { key: string; size: SetSize; mix: Mix; qty: number; unitPrice: number }

export const MAX_SETS = 99

export const mixCount = (mix: Mix) => Object.values(mix).reduce((s, n) => s + (n || 0), 0)

type Pricing = Pick<PublicStore, 'set_prices'>

// Dòng món (nhóm) của một vị: Sữa chua, Bánh flan... Các dòng khác nhau không trộn chung một set
export const lineOf = (item: Pick<MenuItem, 'category'>) => item.category ?? 'Thực đơn'

// Các dòng món trên thực đơn, dòng có nhiều vị đứng trước
export function menuLines(items: MenuItem[]): string[] {
  const count = new Map<string, number>()
  for (const i of items) count.set(lineOf(i), (count.get(lineOf(i)) ?? 0) + 1)
  return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))
}

// Giá một set:
//  1) set chỉ có một vị và quán có đặt giá riêng cho vị đó (vd: 4 hũ toàn Truyền thống) thì dùng giá đó;
//  2) dòng món có từ 2 vị trở lên và có giá mặc định cho cỡ set (giá mix vị) thì dùng giá đó;
//  3) còn lại cộng giá từng hũ. null khi có vị chưa có giá mà không có giá nào ở trên.
export function setPrice(size: SetSize, mix: Mix, items: MenuItem[], store: Pricing): number | null {
  const ids = Object.entries(mix).filter(([, n]) => n > 0).map(([id]) => id)
  const first = items.find((i) => i.id === ids[0])
  if (!first) return null
  if (ids.length === 1) {
    const own = store.set_prices.find((r) => r.size === size && r.product_id === ids[0])
    if (own) return own.price
  }
  const line = items.filter((i) => lineOf(i) === lineOf(first))
  if (line.length >= 2) {
    const mixed = store.set_prices.find((r) => r.size === size && r.product_id === null)
    if (mixed) return mixed.price
  }
  let total = 0
  for (const [id, n] of Object.entries(mix)) {
    if (!n) continue
    const price = items.find((i) => i.id === id)?.price
    if (price === null || price === undefined) return null
    total += n * price
  }
  return total
}

// Vị nào chọn được cho set cỡ này: có giá lẻ, hoặc quán đã đặt giá cho cỡ set đó
export const selectable = (item: MenuItem, size: SetSize, store: Pricing) =>
  item.price !== null || store.set_prices.some((r) => r.size === size && (r.product_id === item.id || r.product_id === null))

// Giá hiện trên nút chọn cỡ set của một dòng món, ví dụ [{ label: 'Truyền thống', price: 50000 }, { label: 'Mix vị', price: 55000 }]
export function setPriceHints(size: SetSize, lineItems: MenuItem[], store: Pricing): { label: string | null; price: number }[] {
  const out: { label: string | null; price: number }[] = []
  for (const item of lineItems) {
    const own = store.set_prices.find((r) => r.size === size && r.product_id === item.id)
    if (own) out.push({ label: item.name, price: own.price })
  }
  const mixed = store.set_prices.find((r) => r.size === size && r.product_id === null)
  if (mixed && lineItems.length >= 2) out.push({ label: 'Mix vị', price: mixed.price })
  if (out.length === 0 && lineItems.length === 1 && lineItems[0].price !== null) out.push({ label: null, price: size * lineItems[0].price })
  return out
}

// Đổi số hũ của một vị trong set đang soạn; không âm và tổng không vượt cỡ set
export function changeMix(mix: Mix, id: string, delta: number, size: SetSize): Mix {
  const current = mix[id] ?? 0
  const next = Math.max(0, Math.min(current + delta, current + (size - mixCount(mix))))
  const out = { ...mix }
  if (next === 0) delete out[id]
  else out[id] = next
  return out
}

// "2 Truyền thống + 2 Phô mai" theo thứ tự thực đơn
export function mixLabel(mix: Mix, items: MenuItem[]): string {
  return items
    .filter((i) => (mix[i.id] ?? 0) > 0)
    .map((i) => `${mix[i.id]} ${i.name}`)
    .join(' + ')
}

const lineKey = (size: SetSize, mix: Mix) =>
  `${size}|${Object.entries(mix)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}:${n}`)
    .join(',')}`

// Thêm set vào đơn: chỉ nhận set đủ số hũ và có giá; set giống hệt đã có thì cộng dồn số set
export function addSet(lines: SetLine[], size: SetSize, mix: Mix, qty: number, items: MenuItem[], store: Pricing): SetLine[] {
  if (mixCount(mix) !== size || qty <= 0) return lines
  // Mọi vị trong một set phải cùng dòng món
  const used = items.filter((i) => (mix[i.id] ?? 0) > 0)
  if (new Set(used.map(lineOf)).size > 1) return lines
  const unitPrice = setPrice(size, mix, items, store)
  if (unitPrice === null) return lines
  const key = lineKey(size, mix)
  const existing = lines.find((l) => l.key === key)
  if (existing) return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_SETS, l.qty + qty), unitPrice } : l))
  return [...lines, { key, size, mix: { ...mix }, qty: Math.min(MAX_SETS, qty), unitPrice }]
}

// Đặt số set của một dòng; 0 hoặc nhỏ hơn thì bỏ dòng
export function setLineQty(lines: SetLine[], key: string, qty: number): SetLine[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key)
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_SETS, qty) } : l))
}

// Bỏ dòng có vị đã không còn trên thực đơn (sau khi thực đơn được tải lại) và cập nhật giá mới
export function refreshCart(lines: SetLine[], items: MenuItem[], store: Pricing): SetLine[] {
  const ids = new Set(items.map((i) => i.id))
  return lines
    .filter((l) => Object.keys(l.mix).every((id) => ids.has(id)))
    .map((l) => ({ ...l, unitPrice: setPrice(l.size, l.mix, items, store) ?? l.unitPrice }))
}

export const cartTotal = (lines: SetLine[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
export const cartSets = (lines: SetLine[]) => lines.reduce((s, l) => s + l.qty, 0)
export const cartJars = (lines: SetLine[]) => lines.reduce((s, l) => s + l.qty * l.size, 0)

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

export type Customer = { name: string; phone: string; address: string; note: string; payment: 'transfer' | 'cash' }
export const EMPTY_CUSTOMER: Customer = { name: '', phone: '', address: '', note: '', payment: 'transfer' }

// Số điện thoại Việt Nam: 9 đến 11 chữ số (sau khi bỏ khoảng trắng, dấu chấm, +84)
export const validPhone = (phone: string) => /^\d{9,11}$/.test(cleanPhone(phone).replace(/^\+84/, '0'))

// Thông tin khách còn thiếu / sai (hiện cạnh ô nhập); rỗng nghĩa là gửi đơn được
export function customerIssues(c: Customer): Partial<Record<'name' | 'phone' | 'address', string>> {
  const out: Partial<Record<'name' | 'phone' | 'address', string>> = {}
  if (!c.name.trim()) out.name = 'Nhập tên của bạn'
  if (!c.phone.trim()) out.phone = 'Nhập số điện thoại'
  else if (!validPhone(c.phone)) out.phone = 'Số điện thoại chưa đúng'
  if (!c.address.trim()) out.address = 'Nhập địa chỉ / số tầng'
  return out
}

// Ảnh QR chuyển khoản VietQR (dịch vụ img.vietqr.io) đã điền sẵn số tiền và nội dung
export function vietQrUrl(bank: PublicBank, amount: number, memo: string): string {
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: memo, accountName: bank.holder })
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.code)}-${encodeURIComponent(bank.account)}-compact2.png?${q}`
}

// Nội dung chuyển khoản: tên quán + số điện thoại khách để quán dễ đối chiếu
export const transferMemo = (storeName: string, phone: string) => `${storeName} ${cleanPhone(phone)}`.trim().slice(0, 50)

// Nội dung đơn đặt trước để dán vào Zalo
export function orderMessage(storeName: string, lines: SetLine[], items: MenuItem[], customer: Partial<Customer> = {}, hasBank = false, code = ''): string {
  const rows = lines.map((l) => `- ${l.qty} set ${l.size} hũ (${mixLabel(l.mix, items)}): ${vnd(l.unitPrice * l.qty)}`)
  const out = [`Xin chào ${storeName}, mình muốn đặt trước${code ? ` (mã đơn ${code})` : ''}:`, ...rows, `Tổng: ${vnd(cartTotal(lines))} (${cartSets(lines)} set, ${cartJars(lines)} hũ)`]
  if (customer.name?.trim()) out.push(`Tên: ${customer.name.trim()}`)
  if (customer.phone?.trim()) out.push(`SĐT: ${customer.phone.trim()}`)
  if (customer.address?.trim()) out.push(`Địa chỉ: ${customer.address.trim()}`)
  if (customer.note?.trim()) out.push(`Ghi chú: ${customer.note.trim()}`)
  if (hasBank && customer.payment) out.push(`Thanh toán: ${customer.payment === 'transfer' ? 'chuyển khoản' : 'tiền mặt khi nhận'}`)
  return out.join('\n')
}

// Số điện thoại chỉ giữ chữ số (và +) để làm link Zalo / gọi
export const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '')
export const zaloLink = (phone: string) => `https://zalo.me/${cleanPhone(phone).replace(/^\+84/, '0')}`
export const telLink = (phone: string) => `tel:${cleanPhone(phone)}`

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd')

// Màu nền thẻ món theo vị (không có ảnh sản phẩm)
export function flavorColors(name: string): [string, string] {
  const n = norm(name)
  if (n.includes('matcha')) return ['#cfe8b0', '#8fb86a']
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return ['#e6c9b3', '#a0694c']
  if (n.includes('nep cam')) return ['#e2c9e6', '#8a5a94']
  if (n.includes('pho mai')) return ['#fbe9a8', '#f0c04a']
  if (n.includes('truyen thong')) return ['#f6efd9', '#e3d2a2']
  if (n.includes('flan')) return ['#fde7bf', '#d9954a']
  return ['#d6ead9', '#7fb58a']
}

// Hình minh hoạ theo vị (public/shop/flavor-*.svg); vị lạ thì null và trang dùng màu nền thay thế
export function flavorImage(name: string): string | null {
  const n = norm(name)
  if (n.includes('matcha')) return '/shop/flavor-matcha.svg'
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return '/shop/flavor-ca-cao.svg'
  if (n.includes('nep cam')) return '/shop/flavor-nep-cam.svg'
  if (n.includes('pho mai')) return '/shop/flavor-pho-mai.svg'
  if (n.includes('truyen thong') || n.includes('nguyen ban')) return '/shop/flavor-truyen-thong.svg'
  if (n.includes('flan')) return '/shop/flavor-banh-flan.svg'
  return null
}

// Mô tả ngắn từng vị hiện dưới tên món; vị lạ thì không có mô tả
export function flavorNote(name: string): string | null {
  const n = norm(name)
  if (n.includes('matcha')) return 'Thơm dịu vị trà xanh'
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return 'Đậm vị sô-cô-la'
  if (n.includes('nep cam')) return 'Dẻo thơm nếp cẩm'
  if (n.includes('pho mai')) return 'Béo mịn vị phô mai'
  if (n.includes('truyen thong') || n.includes('nguyen ban')) return 'Vị nguyên bản, béo dịu'
  if (n.includes('flan')) return 'Mềm mịn, caramel thơm'
  return null
}
