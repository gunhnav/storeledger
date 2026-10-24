import { describe, expect, it } from 'vitest'
import { buildPaymentQr, crc16, describePayload, parseTlv, payloadError, sanitizeMemo } from './emvQr'

// QR "Góp Quỹ" MoMo của quán (QR tĩnh, không có số tiền)
const BASE = '00020101021138630010A000000727013300069710250119PSG26298169000000010208QRIBFTTA53037045802VN62560334mp_42063538_6fxbdws4qi40xzv9cbmb9c0514MM_fund_detail630452E7'

describe('QR chuẩn EMVCo / VietQR', () => {
  it('CRC16 đúng với chuỗi QR của quán', () => {
    expect(crc16(BASE.slice(0, -4))).toBe('52E7')
    expect(payloadError(BASE)).toBeNull()
  })

  it('đọc đúng thông tin: ví MoMo, mã VA của quỹ, dịch vụ chuyển nhanh, QR tĩnh', () => {
    expect(describePayload(BASE)).toEqual({ dynamic: false, bin: '971025', account: 'PSG2629816900000001', service: 'QRIBFTTA', amount: null, purpose: null })
    expect(parseTlv(BASE).map((t) => t.tag)).toEqual(['00', '01', '38', '53', '58', '62', '63'])
  })

  it('báo lỗi khi chép sai hoặc thiếu', () => {
    expect(payloadError(BASE.replace('PSG', 'PSX'))).toContain('CRC')
    expect(payloadError(BASE.slice(0, 60))).not.toBeNull()
    expect(payloadError('abc')).not.toBeNull()
    expect(payloadError('')).not.toBeNull()
  })

  it('thêm số tiền và nội dung, giữ nguyên tài khoản nhận và nhãn quỹ, CRC mới hợp lệ', () => {
    const qr = buildPaymentQr(BASE, 355000, 'HOGI HG262987K3Q')
    expect(payloadError(qr)).toBeNull()
    expect(parseTlv(qr).map((t) => t.tag)).toEqual(['00', '01', '38', '53', '54', '58', '62', '63'])
    const info = describePayload(qr)
    expect(info).toMatchObject({ dynamic: true, bin: '971025', account: 'PSG2629816900000001', service: 'QRIBFTTA', amount: 355000, purpose: 'HOGI HG262987K3Q' })
    const extra = parseTlv(parseTlv(qr).find((t) => t.tag === '62')!.value)
    expect(extra.map((t) => [t.tag, t.value])).toEqual([['03', 'mp_42063538_6fxbdws4qi40xzv9cbmb9c'], ['05', 'MM_fund_detail'], ['08', 'HOGI HG262987K3Q']])
  })

  it('tạo lại từ chính mã đã có số tiền thì thay số tiền, không nhân đôi tag', () => {
    const once = buildPaymentQr(BASE, 50000, 'HOGI A1')
    const twice = buildPaymentQr(once, 80000, 'HOGI B2')
    expect(describePayload(twice)).toMatchObject({ amount: 80000, purpose: 'HOGI B2' })
    expect(parseTlv(twice).filter((t) => t.tag === '54')).toHaveLength(1)
    expect(payloadError(twice)).toBeNull()
  })

  it('từ chối số tiền sai và chuỗi gốc sai', () => {
    expect(() => buildPaymentQr(BASE, 0, 'x')).toThrow('Số tiền')
    expect(() => buildPaymentQr('abc', 1000, 'x')).toThrow()
  })

  it('tái tạo đúng ví dụ "Dynamic QR IBFT to Account" trong tài liệu Napas v1.5.2 (mục 6.3.3), CRC 2E2E', () => {
    const example = '00020101021238570010A00000072701270006970403011300110123456780208QRIBFTTA530370454061800005802VN62340107NPS68690819thanh toan don hang63042E2E'
    expect(crc16(example.slice(0, -4))).toBe('2E2E')
    const staticBase = '00020101021138570010A00000072701270006970403011300110123456780208QRIBFTTA53037045802VN6304'
    const base = staticBase + crc16(staticBase)
    expect(buildPaymentQr(base, 180000, 'thanh toan don hang', 'NPS6869')).toBe(example)
  })

  it('số hoá đơn vào 62/01, nội dung vào 62/08, tag 62 không quá 99 ký tự', () => {
    const qr = buildPaymentQr(BASE, 55000, 'Thanh toan don HG262987K3Q Hogi', 'HG262987K3Q')
    const extra = parseTlv(parseTlv(qr).find((t) => t.tag === '62')!.value)
    expect(extra.find((t) => t.tag === '01')?.value).toBe('HG262987K3Q')
    expect(parseTlv(qr).find((t) => t.tag === '62')!.value.length).toBeLessThanOrEqual(99)
    expect(payloadError(qr)).toBeNull()
  })

  it('nội dung chuyển khoản không dấu, tối đa 25 ký tự', () => {
    expect(sanitizeMemo('Hogi đơn hàng #12!')).toBe('Hogi don hang 12')
    expect(sanitizeMemo('x'.repeat(40))).toHaveLength(25)
  })
})
