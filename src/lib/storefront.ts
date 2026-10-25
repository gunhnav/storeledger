// Trang bán hàng công khai (/hogi, /shop/<mã quán>): ĐẶT TRƯỚC theo set (4 hoặc 6 hũ, tự chọn vị) như kênh Công ty.
// Không lấy tồn kho: ai đặt gì nhận đó. Giỏ hàng gồm dòng set và dòng món lẻ (vd: sữa chua Hy Lạp); nội dung đơn gửi qua Hangout (hoặc Zalo).

export const SET_SIZES = [4, 6] as const
export type SetSize = (typeof SET_SIZES)[number]

// mode: 'set' = gộp vào set 4 / 6 hũ, 'single' = bán lẻ từng phần / chai
export type MenuItem = { id: string; name: string; category: string | null; price: number | null; mode?: 'set' | 'single' }
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
  // Domain liên hệ của quán (tài khoản nội bộ công ty, ví dụ huong.vu3)
  domain: string | null
  // Các tầng được giao (vd: 6, 7, 8, 9, 11, 12); null = không giới hạn
  floors: string[] | null
  chat_url?: string | null
  contact_email?: string | null
}
export type PublicMenu = { store: PublicStore; items: MenuItem[] }

// Số hũ từng vị trong một set: { <mã món>: số hũ }
export type Mix = Record<string, number>
export type SetLine = { kind: 'set'; key: string; size: SetSize; mix: Mix; qty: number; unitPrice: number }
// Món bán lẻ (không theo set)
export type SingleLine = { kind: 'single'; key: string; productId: string; qty: number; unitPrice: number }
export type CartLine = SetLine | SingleLine

export const isSingle = (item: Pick<MenuItem, 'mode'>) => item.mode === 'single'
// Đơn vị bán lẻ: chai (đồ uống theo ml) hoặc hũ
export const unitOf = (name: string) => (/chai|\d\s*ml|whey/i.test(name) ? 'chai' : 'hũ')

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
export function addSet(lines: CartLine[], size: SetSize, mix: Mix, qty: number, items: MenuItem[], store: Pricing): CartLine[] {
  if (mixCount(mix) !== size || qty <= 0) return lines
  // Mọi vị trong một set phải cùng dòng món
  const used = items.filter((i) => (mix[i.id] ?? 0) > 0)
  if (new Set(used.map(lineOf)).size > 1) return lines
  const unitPrice = setPrice(size, mix, items, store)
  if (unitPrice === null) return lines
  const key = lineKey(size, mix)
  const existing = lines.find((l) => l.key === key)
  if (existing) return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_SETS, l.qty + qty), unitPrice } : l))
  return [...lines, { kind: 'set', key, size, mix: { ...mix }, qty: Math.min(MAX_SETS, qty), unitPrice }]
}

// Đặt số lượng món lẻ trong đơn (0 = bỏ món); món chưa có giá thì không thêm
export function setSingleQty(lines: CartLine[], item: MenuItem, qty: number): CartLine[] {
  const key = `p|${item.id}`
  if (qty <= 0 || item.price === null) return lines.filter((l) => l.key !== key)
  const next: SingleLine = { kind: 'single', key, productId: item.id, qty: Math.min(MAX_SETS, qty), unitPrice: item.price }
  return lines.some((l) => l.key === key) ? lines.map((l) => (l.key === key ? next : l)) : [...lines, next]
}

// Số lượng một món lẻ đang có trong đơn
export const singleQty = (lines: CartLine[], productId: string) => lines.find((l) => l.kind === 'single' && l.productId === productId)?.qty ?? 0

// Đặt số set của một dòng; 0 hoặc nhỏ hơn thì bỏ dòng
export function setLineQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key)
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_SETS, qty) } : l))
}

// Bỏ dòng có vị đã không còn trên thực đơn (sau khi thực đơn được tải lại) và cập nhật giá mới
export function refreshCart(lines: CartLine[], items: MenuItem[], store: Pricing): CartLine[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: CartLine[] = []
  for (const l of lines) {
    if (l.kind === 'single') {
      const price = byId.get(l.productId)?.price
      if (price !== null && price !== undefined) out.push({ ...l, unitPrice: price })
    } else if (Object.keys(l.mix).every((id) => byId.has(id))) {
      out.push({ ...l, unitPrice: setPrice(l.size, l.mix, items, store) ?? l.unitPrice })
    }
  }
  return out
}

export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
// Số set trong đơn (không tính món lẻ)
export const cartSets = (lines: CartLine[]) => lines.reduce((s, l) => s + (l.kind === 'set' ? l.qty : 0), 0)
// Số hũ trong các set
export const cartJars = (lines: CartLine[]) => lines.reduce((s, l) => s + (l.kind === 'set' ? l.qty * l.size : 0), 0)
// Số món lẻ
export const cartSingles = (lines: CartLine[]) => lines.reduce((s, l) => s + (l.kind === 'single' ? l.qty : 0), 0)
// Tổng số thứ trong đơn (để hiện trên nút giỏ hàng)
export const cartCount = (lines: CartLine[]) => cartSets(lines) + cartSingles(lines)

// "2 set (8 hũ) + 3 món lẻ"
export function cartSummary(lines: CartLine[]): string {
  const parts: string[] = []
  if (cartSets(lines)) parts.push(`${cartSets(lines)} set (${cartJars(lines)} hũ)`)
  if (cartSingles(lines)) parts.push(`${cartSingles(lines)} món lẻ`)
  return parts.join(' + ')
}

// Tên và mô tả một dòng trong đơn: set thì "Set 4 hũ" + các vị; món lẻ thì tên món + đơn vị
export function lineTitle(l: CartLine, items: MenuItem[]): { title: string; detail: string; unit: string } {
  if (l.kind === 'set') return { title: `Set ${l.size} hũ`, detail: mixLabel(l.mix, items), unit: 'set' }
  const name = items.find((i) => i.id === l.productId)?.name ?? 'Món'
  return { title: name, detail: 'Bán lẻ', unit: unitOf(name) }
}

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Khách đặt trong công ty: giao theo domain (tài khoản nội bộ) và tầng
export type Customer = { name: string; domain: string; floor: string; payment: 'transfer' | 'cash' }
export const EMPTY_CUSTOMER: Customer = { name: '', domain: '', floor: '', payment: 'transfer' }

// Domain nội bộ: chữ không dấu, số, dấu chấm, gạch (ví dụ huong.vu3)
export const cleanDomain = (domain: string) => domain.trim().toLowerCase().replace(/@.*$/, '')
export const validDomain = (domain: string) => /^[a-z0-9._-]{2,40}$/.test(cleanDomain(domain))

// "6", "F6", "tầng 6", "Lầu 6" -> "6"; tầng là số hoặc chữ ngắn (vd: B1, G)
export const cleanFloor = (floor: string) =>
  floor
    .trim()
    .replace(/^(f|tầng|tang|lầu|lau)\s*/i, '')
    .trim()
    .toUpperCase()
export const validFloor = (floor: string) => /^[A-Z0-9]{1,4}$/.test(cleanFloor(floor))

// Thông tin khách còn thiếu / sai (hiện cạnh ô nhập); rỗng nghĩa là gửi đơn được
export function customerIssues(c: Customer, floors: string[] | null = null): Partial<Record<'name' | 'domain' | 'floor', string>> {
  const out: Partial<Record<'name' | 'domain' | 'floor', string>> = {}
  if (!c.domain.trim()) out.domain = 'Nhập domain của bạn'
  else if (!validDomain(c.domain)) out.domain = 'Domain chỉ gồm chữ không dấu, số và dấu chấm (vd: huong.vu3)'
  if (!c.floor.trim()) out.floor = floors ? 'Chọn tầng' : 'Nhập tầng'
  else if (!validFloor(c.floor)) out.floor = 'Tầng chưa đúng (vd: 6)'
  else if (floors && !floors.includes(cleanFloor(c.floor))) out.floor = `Chỉ giao tầng ${floors.join(', ')}`
  return out
}

// Nội dung chuyển khoản theo dạng "domain - F tầng", ví dụ "huong.vu3 - F6"
export const transferNote = (domain: string, floor: string) => `${cleanDomain(domain)} - F${cleanFloor(floor)}`

// Ảnh QR chuyển khoản VietQR (dịch vụ img.vietqr.io) đã điền sẵn số tiền và nội dung
export function vietQrUrl(bank: PublicBank, amount: number, memo: string): string {
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: memo, accountName: bank.holder })
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.code)}-${encodeURIComponent(bank.account)}-compact2.png?${q}`
}

// Đơn gửi lên máy chủ (submit_preorder): chỉ gửi món và số lượng, giá do máy chủ tự tính
export function preorderPayload(lines: CartLine[], c: Customer) {
  const d = cleanDomain(c.domain)
  return {
    name: c.name?.trim() || d,
    domain: d,
    floor: cleanFloor(c.floor),
    payment: c.payment,
    lines: lines.map((l) => (l.kind === 'set' ? { kind: 'set', size: l.size, mix: l.mix, qty: l.qty } : { kind: 'single', product_id: l.productId, qty: l.qty })),
  }
}

// Đơn máy chủ đã ghi nhận (mã đơn, tổng tiền và các món với giá tính trên máy chủ)
export type PlacedLine = { kind: 'set' | 'single'; title: string; detail: string; qty: number; unit_price: number }
export type PlacedOrder = { code: string; total: number; lines: PlacedLine[] }

// Nội dung đơn đặt trước để dán vào Hangout / Zalo
export function orderMessage(storeName: string, lines: CartLine[], items: MenuItem[], customer: Partial<Customer> = {}, hasBank = false, code = ''): string {
  const rows = lines.map((l) => {
    if (l.kind === 'set') return `- ${l.qty} set ${l.size} hũ (${mixLabel(l.mix, items)}): ${vnd(l.unitPrice * l.qty)}`
    const { title, unit } = lineTitle(l, items)
    return `- ${l.qty} ${unit} ${title}: ${vnd(l.unitPrice * l.qty)}`
  })
  const out = [`Xin chào ${storeName}, mình muốn đặt trước${code ? ` (mã đơn ${code})` : ''}:`, ...rows, `Tổng: ${vnd(cartTotal(lines))} (${cartSummary(lines)})`]
  if (customer.name?.trim()) out.push(`Tên: ${customer.name.trim()}`)
  if (customer.domain?.trim()) out.push(`Domain: ${cleanDomain(customer.domain)}`)
  if (customer.floor?.trim()) out.push(`Tầng: ${cleanFloor(customer.floor)}`)
  if (hasBank && customer.payment) out.push(`Thanh toán: ${customer.payment === 'transfer' ? 'chuyển khoản' : 'tiền mặt khi nhận'}`)
  return out.join('\n')
}

// Số điện thoại chỉ giữ chữ số (và +) để làm link Zalo / gọi
export const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '')
export const zaloLink = (phone: string) => `https://zalo.me/${cleanPhone(phone).replace(/^\+84/, '0')}`
export const telLink = (phone: string) => `tel:${cleanPhone(phone)}`

// Hangout (Google Chat): liên hệ theo domain (ví dụ huong.vu3)
export const hangoutEmail = (domain: string, storeEmail?: string | null) => {
  return cleanDomain(domain || storeEmail || '')
}
export const GOOGLE_CHAT_URL = (import.meta.env.VITE_GOOGLE_CHAT_URL ?? 'https://chat.google.com/').trim()

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
  if (n.includes('whey')) return ['#fbf6dc', '#e8d98a']
  if (n.includes('lam quen') || n.includes('tri ky') || n.includes('hy lap')) return ['#e6f0fa', '#9fbfdc']
  return ['#d6ead9', '#7fb58a']
}

// Biểu tượng thay hình khi món chưa có hình minh hoạ
export const flavorEmoji = (name: string) => (/whey|chai|ml/i.test(norm(name)) ? '🥛' : '🥣')

// Hình minh hoạ theo vị; vị lạ thì null và trang dùng màu nền thay thế
export function flavorImage(name: string): string | null {
  const n = norm(name)
  if (n.includes('matcha')) return '/shop/matcha.jpg'
  if (n.includes('ca cao') || n.includes('cacao') || n.includes('socola')) return '/shop/cacao.jpg'
  if (n.includes('nep cam')) return '/shop/nepcam.jpg'
  if (n.includes('pho mai')) return '/shop/phomai.jpg'
  if (n.includes('truyen thong') || n.includes('nguyen ban')) return '/shop/truyenthong.jpg'
  if (n.includes('flan')) return '/shop/flan.jpeg'
  if (n.includes('whey') || n.includes('tri ky') || n.includes('400')) return '/shop/hilaplon.jpeg'
  if (n.includes('hy lap') || n.includes('lam quen')) return '/shop/hilap.jpeg'
  return null
}

// Điểm căn chỉnh ảnh để các món không bị sát nắp hoặc lệch trọng tâm
export function flavorPosition(name: string): string {
  const n = norm(name)
  if (n.includes('hy lap') || n.includes('lam quen')) return 'center 18%'
  if (n.includes('tri ky') || n.includes('400') || n.includes('whey')) return 'center 35%'
  if (n.includes('flan')) return 'center 35%'
  return 'center 28%'
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
  if (n.includes('whey')) return 'Nước whey từ sữa chua Hy Lạp'
  if (n.includes('lam quen')) return 'Sữa chua Hy Lạp, hũ nhỏ dùng thử'
  if (n.includes('tri ky')) return 'Sữa chua Hy Lạp, hũ lớn dùng cả tuần'
  return null
}

const MENU_CACHE_PREFIX = 'hogi_public_menu_'

// Lưu bộ nhớ đệm thực đơn để khách vào lại hoặc chuyển tab được tải tức thì (0ms)
export function getCachedMenu(code: string, storage?: { getItem: (k: string) => string | null }): PublicMenu | null {
  const s = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null)
  if (!s || !code) return null
  try {
    const raw = s.getItem(MENU_CACHE_PREFIX + code)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts: number; data: PublicMenu }
    if (parsed?.data?.store && Array.isArray(parsed?.data?.items) && parsed.data.items.length > 0) {
      return parsed.data
    }
    return null
  } catch {
    return null
  }
}

export function setCachedMenu(code: string, menu: PublicMenu, storage?: { setItem: (k: string, v: string) => void }): void {
  const s = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null)
  if (!s || !code) return
  try {
    const payload = JSON.stringify({ ts: Date.now(), data: menu })
    s.setItem(MENU_CACHE_PREFIX + code, payload)
  } catch {
    // Không làm gián đoạn nếu bộ nhớ đầy hoặc chế độ ẩn danh
  }
}
