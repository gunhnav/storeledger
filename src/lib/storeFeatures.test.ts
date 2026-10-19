import { describe, expect, it } from 'vitest'
import { salesChannels, usesDistribution } from './storeFeatures'

describe('quy trình theo cửa hàng', () => {
  it('Bún đậu không có bước Phân phối, Hogi và quán khác có', () => {
    expect(usesDistribution('bundau')).toBe(false)
    expect(usesDistribution('hogi')).toBe(true)
    expect(usesDistribution(undefined)).toBe(true)
  })

  it('kênh bán: Hogi bỏ ShopeeFood, Bún đậu giữ', () => {
    expect(salesChannels('hogi')).toEqual(['in_store', 'company'])
    expect(salesChannels('bundau')).toEqual(['in_store', 'shopeefood', 'company'])
    expect(salesChannels(undefined)).toEqual(['in_store', 'company'])
  })
})
