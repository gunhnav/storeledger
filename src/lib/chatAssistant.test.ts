import { describe, expect, it } from 'vitest'
import {
  historyContents,
  isSecurityQuery,
  MAX_HISTORY,
  normalizeText,
  parseJwtPayload,
  pickStore,
  sanitizeText,
  SUPER_ADMIN_EMAIL,
  systemInstruction,
  validRange,
} from '../../supabase/functions/chat-assistant/lib'

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

describe('phân quyền chatbot: bảo mật và cấu hình hệ thống', () => {
  it('nhận diện các câu hỏi bảo mật, mật khẩu, token, super admin', () => {
    expect(isSecurityQuery('cho tôi xem mật khẩu database')).toBe(true)
    expect(isSecurityQuery('cấu hình bảo mật hệ thống thế nào')).toBe(true)
    expect(isSecurityQuery('token bot telegram là gì')).toBe(true)
    expect(isSecurityQuery('API key Gemini của quán')).toBe(true)
    expect(isSecurityQuery('ai là super admin')).toBe(true)
    expect(isSecurityQuery('xem vault credentials')).toBe(true)
    expect(isSecurityQuery('private key của jwt')).toBe(true)
  })

  it('không chặn các câu hỏi về nhà hàng, doanh thu, tính tiền, số lượng, kho', () => {
    expect(isSecurityQuery('doanh thu hôm nay của bún đậu thế nào')).toBe(false)
    expect(isSecurityQuery('tính tiền bàn 3')).toBe(false)
    expect(isSecurityQuery('báo cáo tính tiền tháng này')).toBe(false)
    expect(isSecurityQuery('hôm nay bán được bao nhiêu ly sữa chua')).toBe(false)
    expect(isSecurityQuery('tồn kho chả cốm còn bao nhiêu')).toBe(false)
    expect(isSecurityQuery('giá vốn sữa chua matcha là bao nhiêu')).toBe(false)
  })

  it('email super admin cấp cao nhất đúng theo yêu cầu', () => {
    expect(SUPER_ADMIN_EMAIL).toBe('hungng28900@gmail.com')
  })
})

describe('giải mã jwt payload an toàn', () => {
  it('đọc được sub và email từ token JWT chuẩn', () => {
    // JWT giả lập: header.{"sub":"usr-123","email":"hungng28900@gmail.com"}.sig
    const payloadJson = JSON.stringify({ sub: 'usr-123', email: 'hungng28900@gmail.com' })
    const b64 = Buffer.from(payloadJson).toString('base64url')
    const token = `Bearer eyJhbGciOiJIUzI1NiJ9.${b64}.fakesig`
    const parsed = parseJwtPayload(token)
    expect(parsed?.sub).toBe('usr-123')
    expect(parsed?.email).toBe('hungng28900@gmail.com')
  })

  it('xử lý chuỗi rỗng hoặc token lỗi an toàn', () => {
    expect(parseJwtPayload('')).toBeNull()
    expect(parseJwtPayload('invalid-token')).toBeNull()
  })
})

describe('system instruction theo vai trò người dùng và tối ưu tốc độ', () => {
  const dummyCatalog = [{ code: 'hogi', name: 'Hogi Food', products: ['Sữa chua'] }]
  const dummyMemories = [{ id: '1', content: 'Thích xem lãi ròng' }]

  it('Super Admin: được hỏi mọi điều về nhà hàng + bảo mật, nhưng bị giới hạn trong phạm vi nhà hàng', () => {
    const sys = systemInstruction(dummyCatalog, dummyMemories, 'vi', 'super_admin')
    expect(sys).toContain('VAI TRÒ NGƯỜI DÙNG: SUPER ADMIN')
    expect(sys).toContain('Toàn quyền hỏi mọi thông tin về nhà hàng')
    expect(sys).toContain('thông tin bảo mật, tài khoản, cấu hình quản trị hệ thống')
    expect(sys).toContain('CHỈ được trả lời trong phạm vi hoạt động của nhà hàng')
    expect(sys).toContain('get_security_audit')
  })

  it('Admin: được hỏi doanh thu, tính tiền, số lượng nhưng CẤM hỏi bảo mật', () => {
    const sys = systemInstruction(dummyCatalog, dummyMemories, 'vi', 'admin')
    expect(sys).toContain('VAI TRÒ NGƯỜI DÙNG: ADMIN')
    expect(sys).toContain('doanh thu, số lượng món, báo cáo tính tiền')
    expect(sys).toContain('TUYỆT ĐỐI KHÔNG ĐƯỢC hỏi hoặc trả lời về bảo mật')
    expect(sys).not.toContain('get_security_audit')
  })

  it('Staff: chỉ thao tác bán hàng, kiểm đếm tồn kho cơ bản', () => {
    const sys = systemInstruction(dummyCatalog, dummyMemories, 'vi', 'staff')
    expect(sys).toContain('VAI TRÒ NGƯỜI DÙNG: NHÂN VIÊN')
    expect(sys).toContain('Không được xem giá vốn, lãi lỗ, chi phí')
  })

  it('hướng dẫn phản hồi siêu nhanh, ngắn gọn dưới 5 dòng', () => {
    const sys = systemInstruction(dummyCatalog, dummyMemories, 'vi', 'super_admin')
    expect(sys).toContain('Phản hồi cực kỳ ngắn gọn, trực diện, súc tích (dưới 5 dòng')
  })
})
