import { describe, expect, it } from 'vitest'
import { isOutdated } from './appVersion'

describe('kiểm tra phiên bản app', () => {
  it('chỉ cũ khi server báo mã khác', () => {
    expect(isOutdated('1', '2')).toBe(true)
    expect(isOutdated('2', '2')).toBe(false)
  })
  it('không đọc được version.json hoặc đang chạy dev thì không coi là cũ', () => {
    expect(isOutdated('1', null)).toBe(false)
    expect(isOutdated('dev', '2')).toBe(false)
  })
})
