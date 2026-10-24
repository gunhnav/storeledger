// Chuỗi QR thanh toán chuẩn EMVCo / VietQR (Napas): đọc, kiểm tra CRC, và thêm số tiền + nội dung chuyển khoản vào một
// chuỗi QR gốc (ví dụ QR "Góp Quỹ" của MoMo) để khách quét là có sẵn đúng số tiền của đơn.
// Cấu trúc: lặp lại [tag 2 số][độ dài 2 số][giá trị]. Tag 63 (CRC16/CCITT-FALSE) luôn đứng cuối.

export type Tlv = { tag: string; value: string }

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) viết hoa 4 ký tự hex
export function crc16(text: string): string {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function parseTlv(text: string): Tlv[] {
  const out: Tlv[] = []
  let i = 0
  while (i < text.length) {
    const tag = text.slice(i, i + 2)
    const len = Number(text.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(text.slice(i + 2, i + 4)) || i + 4 + len > text.length) throw new Error('Chuỗi QR không đúng cấu trúc')
    out.push({ tag, value: text.slice(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return out
}

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`
const build = (items: Tlv[]) => items.map((t) => tlv(t.tag, t.value)).join('')
const get = (items: Tlv[], tag: string) => items.find((t) => t.tag === tag)?.value

// Kiểm tra chuỗi QR: đúng cấu trúc, có đủ tag bắt buộc và CRC khớp. Trả về thông báo lỗi tiếng Việt hoặc null nếu hợp lệ.
export function payloadError(payload: string): string | null {
  const text = payload.trim()
  if (!/^[\x20-\x7e]+$/.test(text)) return 'Chuỗi QR chỉ gồm ký tự chữ và số thông thường'
  let items: Tlv[]
  try {
    items = parseTlv(text)
  } catch {
    return 'Chuỗi QR không đúng cấu trúc, kiểm tra lại đã chép đủ chưa'
  }
  if (items[0]?.tag !== '00' || items[0].value !== '01') return 'Chuỗi QR phải bắt đầu bằng 000201'
  const last = items[items.length - 1]
  if (last.tag !== '63' || last.value.length !== 4) return 'Chuỗi QR thiếu mã kiểm tra CRC ở cuối'
  if (crc16(text.slice(0, -4)) !== last.value.toUpperCase()) return 'Mã kiểm tra CRC của chuỗi QR không khớp, có thể chép thiếu hoặc sai ký tự'
  if (get(items, '53') !== '704') return 'QR này không dùng đồng Việt Nam'
  if (!items.some((t) => t.tag === '38')) return 'Chuỗi QR thiếu thông tin tài khoản nhận (tag 38)'
  return null
}

export type PayloadInfo = {
  dynamic: boolean
  // BIN ngân hàng / ví nhận (971025 = MoMo), số tài khoản hoặc mã VA nhận, mã dịch vụ (QRIBFTTA = chuyển nhanh về tài khoản)
  bin: string | null
  account: string | null
  service: string | null
  amount: number | null
  purpose: string | null
}

// Đọc các thông tin chính của chuỗi QR để hiện cho người dùng kiểm tra
export function describePayload(payload: string): PayloadInfo {
  const items = parseTlv(payload.trim())
  const acct = parseTlv(get(items, '38') ?? '')
  const bank = parseTlv(get(acct, '01') ?? '')
  const extra = parseTlv(get(items, '62') ?? '')
  const amount = get(items, '54')
  return {
    dynamic: get(items, '01') === '12',
    bin: get(bank, '00') ?? null,
    account: get(bank, '01') ?? null,
    service: get(acct, '02') ?? null,
    amount: amount ? Number(amount) : null,
    purpose: get(extra, '08') ?? null,
  }
}

// Giá trị trong tag 62 (ans, tối đa 25 ký tự theo Napas): bỏ dấu tiếng Việt, chỉ giữ chữ, số và khoảng trắng
export function sanitizeMemo(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25)
}

// Từ chuỗi QR gốc (thường là QR tĩnh) tạo QR động cho một đơn, theo mẫu "Dynamic QR IBFT to Account" của Napas (v1.5.2, mục 6.3.3):
//  - tag 01 = 12 (QR chỉ dùng cho một giao dịch), tag 54 = số tiền (chỉ chữ số);
//  - tag 62/01 = số hoá đơn (Bill Number), tag 62/08 = mục đích / nội dung giao dịch (mỗi trường tối đa 25 ký tự);
//  - giữ nguyên mọi tag khác (tài khoản nhận, nhãn quỹ...), sắp tag tăng dần, tính lại CRC.
export function buildPaymentQr(base: string, amount: number, memo: string, billNumber = ''): string {
  const error = payloadError(base)
  if (error) throw new Error(error)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999_999_999_999) throw new Error('Số tiền không hợp lệ')
  const items = parseTlv(base.trim()).filter((t) => t.tag !== '63' && t.tag !== '54')
  const set = (tag: string, value: string) => {
    const i = items.findIndex((t) => t.tag === tag)
    if (i >= 0) items[i] = { tag, value }
    else items.push({ tag, value })
  }
  set('01', '12')
  set('54', String(Math.round(amount)))

  const extra = parseTlv(get(items, '62') ?? '').filter((t) => t.tag !== '01' && t.tag !== '08')
  const bill = sanitizeMemo(billNumber).replace(/ /g, '')
  const cleanMemo = sanitizeMemo(memo)
  if (bill) extra.push({ tag: '01', value: bill })
  if (cleanMemo) extra.push({ tag: '08', value: cleanMemo })
  extra.sort((a, b) => a.tag.localeCompare(b.tag))
  // Tag 62 tối đa 99 ký tự: nếu vượt thì rút ngắn nội dung (08) trước
  let extraText = build(extra)
  const memoItem = extra.find((t) => t.tag === '08')
  if (extraText.length > 99 && memoItem) {
    memoItem.value = memoItem.value.slice(0, Math.max(0, memoItem.value.length - (extraText.length - 99))).trim()
    extraText = build(extra.filter((t) => t.value))
  }
  if (extraText.length > 99) throw new Error('Thông tin thêm của QR quá dài')
  if (extraText) set('62', extraText)

  items.sort((a, b) => a.tag.localeCompare(b.tag))
  const body = build(items) + '6304'
  return body + crc16(body)
}
