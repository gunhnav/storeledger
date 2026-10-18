import { describe, expect, it } from 'vitest'
import { usesDistribution } from './storeFeatures'

describe('quy trình theo cửa hàng', () => {
  it('Bún đậu không có bước Phân phối, Hogi và quán khác có', () => {
    expect(usesDistribution('bundau')).toBe(false)
    expect(usesDistribution('hogi')).toBe(true)
    expect(usesDistribution(undefined)).toBe(true)
  })
})
