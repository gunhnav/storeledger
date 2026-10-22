import { describe, expect, it } from 'vitest'
import { historyContents, MAX_HISTORY, normalizeText, pickStore, sanitizeText, validRange } from '../../supabase/functions/chat-assistant/lib'

const stores = [
  { code: 'hogi', name: 'Hogi Food' },
  { code: 'bundau', name: 'Bún Đậu Em Thuỷ' },
]

describe('nhận diện cửa hàng từ câu người dùng / tham số công cụ', () => {
  it.each([
    ['hogi', 'hogi'],
    ['Hogi', 'hogi'],
    ['HOGI FOOD', 'hogi'],
    ['bundau', 'bundau'],
    ['bún đậu', 'bundau'],
    ['Bun Dau', 'bundau'],
    ['bún đậu em thuỷ', 'bundau'],
  ])('"%s" -> %s', (input, code) => {
    expect(pickStore(stores, input)?.code).toBe(code)
  })

  it('không đoán bừa khi không khớp hoặc rỗng', () => {
    expect(pickStore(stores, 'pizza')).toBeUndefined()
    expect(pickStore(stores, '')).toBeUndefined()
    expect(pickStore(stores, undefined)).toBeUndefined()
  })

  it('bỏ dấu tiếng Việt, đ -> d', () => {
    expect(normalizeText('Bún Đậu')).toBe('bun dau')
  })
})

describe('khoảng ngày của công cụ', () => {
  it('hợp lệ', () => {
    expect(validRange('2026-10-10', '2026-10-20')).toEqual({ from: '2026-10-10', to: '2026-10-20' })
    expect(validRange('2026-10-10', '2026-10-10')).not.toBeNull()
  })
  it('từ > đến, sai định dạng hoặc thiếu thì từ chối', () => {
    expect(validRange('2026-10-20', '2026-10-10')).toBeNull()
    expect(validRange('10/10/2026', '20/10/2026')).toBeNull()
    expect(validRange(undefined, '2026-10-10')).toBeNull()
  })
})

describe('lịch sử hội thoại gửi cho model', () => {
  it('không phải mảng thì bỏ', () => {
    expect(historyContents(undefined)).toEqual([])
    expect(historyContents('x')).toEqual([])
  })

  it('đổi assistant -> model, gộp các lượt liền nhau cùng vai', () => {
    const out = historyContents([
      { role: 'user', text: 'a' },
      { role: 'user', text: 'b' },
      { role: 'assistant', text: 'c' },
      { role: 'user', text: 'd' },
    ])
    expect(out.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(out[0].parts.map((p) => p.text)).toEqual(['a', 'b'])
  })

  it('bỏ các lượt model ở đầu (Gemini yêu cầu bắt đầu bằng user) và tin rỗng', () => {
    const out = historyContents([
      { role: 'assistant', text: 'chào' },
      { role: 'user', text: '   ' },
      { role: 'user', text: 'hogi' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('user')
  })

  it('chỉ giữ MAX_HISTORY tin gần nhất và cắt tin quá dài', () => {
    const many = Array.from({ length: MAX_HISTORY + 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }))
    const flat = historyContents(many).flatMap((c) => c.parts.map((p) => p.text))
    expect(flat.length).toBeLessThanOrEqual(MAX_HISTORY)
    expect(flat.at(-1)).toBe(`m${MAX_HISTORY + 9}`)
    const long = historyContents([{ role: 'user', text: 'x'.repeat(5000) }])
    expect(long[0].parts[0].text!.length).toBe(1500)
  })

  it('che IP / chuỗi kết nối trong lịch sử', () => {
    const out = historyContents([{ role: 'user', text: 'server 10.1.2.3 postgres://u:p@host/db' }])
    expect(out[0].parts[0].text).not.toMatch(/10\.1\.2\.3|postgres:\/\//)
  })
})

describe('che thông tin nhạy cảm', () => {
  it('IP, URL, chuỗi kết nối, mật khẩu', () => {
    const t = sanitizeText('ip 192.168.1.10, https://example.com/x, mysql://root:1@db/x, password: "abc"')
    expect(t).toContain('[REDACTED_IP]')
    expect(t).toContain('[REDACTED_URL]')
    expect(t).toContain('[REDACTED_DB_URL]')
    expect(t).not.toContain('abc')
  })
  it('chuỗi rỗng', () => {
    expect(sanitizeText('')).toBe('')
  })
})
