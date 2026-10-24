// Mã hoá đơn và nội dung chuyển khoản của đơn đặt trước, tự tạo theo kiểu mã VA nội bộ MoMo:
// tiền tố + 2 số cuối năm + ngày trong năm (3 số) + 4 ký tự ngẫu nhiên-ổn-định, ví dụ HG262987K3Q.
// Ký tự bỏ 0 O 1 I L để khách đọc / gõ không nhầm.

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0)
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((today - start) / 86_400_000)
}

// FNV-1a 32 bit: cùng chuỗi cho cùng số
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// seed gồm mã ngẫu nhiên của lượt truy cập và nội dung giỏ hàng: cùng đơn thì cùng mã, đơn khác thì mã khác
export function invoiceCode(date: Date, seed: string, prefix = 'HG'): string {
  let h = hash32(seed)
  let tail = ''
  for (let i = 0; i < 4; i++) {
    tail += ALPHABET[h % ALPHABET.length]
    h = Math.floor(h / ALPHABET.length)
  }
  return `${prefix}${String(date.getFullYear()).slice(-2)}${String(dayOfYear(date)).padStart(3, '0')}${tail}`
}

// Nội dung chuyển khoản kèm mã hoá đơn để quán đối chiếu
export const invoiceMemo = (code: string, brand = 'HOGI') => `${brand} ${code}`

// Mã ngẫu nhiên cho mỗi lượt truy cập (để hai khách cùng đặt một giỏ không trùng mã)
export function randomSalt(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}
