import { describe, expect, it } from 'vitest'
import { isSlipColour, readSlip, stripSlip, withSlip } from './slip'

describe('slip node', () => {
  it('chỉ nhận màu dạng chữ thuần', () => {
    expect(isSlipColour('#256b40')).toBe(true)
    expect(isSlipColour('#fff')).toBe(true)
    expect(isSlipColour('rgb(247, 243, 234)')).toBe(true)
    expect(isSlipColour('rgba(0,0,0,0.5)')).toBe(true)
    expect(isSlipColour('red;background:url(x)')).toBe(false)
    expect(isSlipColour('url(javascript:1)')).toBe(false)
    expect(isSlipColour('')).toBe(false)
    expect(isSlipColour(null)).toBe(false)
  })

  it('gắn tham số slip, giữ query và hash cũ', () => {
    const url = new URL(withSlip('https://hogi.example/shop/hogi?ref=zalo#chon-set', '#256b40'))
    expect(url.searchParams.get('slip')).toBe('1')
    expect(url.searchParams.get('slipbg')).toBe('#256b40')
    expect(url.searchParams.get('ref')).toBe('zalo')
    expect(url.hash).toBe('#chon-set')
  })

  it('màu sai mẫu thì dùng màu dự phòng', () => {
    expect(new URL(withSlip('/shop/hogi', 'oklch(0.5 0.1 140)', 'https://a.example')).searchParams.get('slipbg')).toBe('#000')
    expect(readSlip('?slip=1&slipbg=red;x')).toBe('#000')
  })

  it('đọc màu đến chỉ khi slip=1', () => {
    expect(readSlip('?slip=1&slipbg=%23256b40')).toBe('#256b40')
    expect(readSlip('?slipbg=%23256b40')).toBeNull()
    expect(readSlip('')).toBeNull()
  })

  it('dọn tham số slip khỏi URL', () => {
    expect(stripSlip('https://a.example/shop/hogi?slip=1&slipbg=%23000&slipx=4&slipy=2&ref=zalo#lien-he')).toBe('/shop/hogi?ref=zalo#lien-he')
    expect(stripSlip('https://a.example/?slip=1&slipbg=%23000')).toBe('/')
  })
})
