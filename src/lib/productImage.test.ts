import { describe, expect, it } from 'vitest'
import {
  clampFrame,
  fitSize,
  frameFrom,
  frameStyle,
  imagePath,
  panFrame,
  parsePosition,
  storagePathFromUrl,
  validateImageFile,
} from './productImage'
import { menuImage } from './storefront'

describe('ảnh món: khung căn chỉnh', () => {
  it('đọc object-position', () => {
    expect(parsePosition('center 28%')).toEqual({ x: 50, y: 28 })
    expect(parsePosition('left bottom')).toEqual({ x: 0, y: 100 })
    expect(parsePosition('30% 70%')).toEqual({ x: 30, y: 70 })
    expect(parsePosition('')).toEqual({ x: 50, y: 50 })
  })

  it('giới hạn điểm căn 0..100 và độ phóng 1..3', () => {
    expect(clampFrame({ x: -5, y: 120, zoom: 9 })).toEqual({ x: 0, y: 100, zoom: 3 })
    expect(clampFrame({ x: Number.NaN, y: 33.333, zoom: 0.2 })).toEqual({ x: 50, y: 33.33, zoom: 1 })
  })

  it('chưa căn thì dùng vị trí mặc định theo tên món', () => {
    expect(frameFrom({ image_x: null, image_y: null, image_zoom: null }, 'center 18%')).toEqual({ x: 50, y: 18, zoom: 1 })
    expect(frameFrom({ image_x: 20, image_y: 80, image_zoom: 1.5 }, 'center 18%')).toEqual({ x: 20, y: 80, zoom: 1.5 })
  })

  it('style dùng chung cho thẻ món và khung sửa', () => {
    expect(frameStyle({ x: 20, y: 80, zoom: 1.5 })).toEqual({ objectPosition: '20% 80%', transformOrigin: '20% 80%', '--img-zoom': 1.5 })
  })

  it('kéo ảnh: kéo sang phải thì thấy thêm phần bên trái', () => {
    // Ảnh ngang 2000x1000 trong khung 200x200: dư 200px theo chiều ngang, không dư chiều dọc
    const f = panFrame({ x: 50, y: 50, zoom: 1 }, 50, 30, { w: 200, h: 200 }, { w: 2000, h: 1000 })
    expect(f.x).toBe(25)
    expect(f.y).toBe(50)
    // Phóng to thì chiều dọc cũng dịch được
    const z = panFrame({ x: 50, y: 50, zoom: 2 }, 0, -20, { w: 200, h: 200 }, { w: 2000, h: 1000 })
    expect(z.y).toBe(60)
    expect(panFrame({ x: 50, y: 50, zoom: 1 }, 10, 10, { w: 0, h: 0 }, { w: 10, h: 10 })).toEqual({ x: 50, y: 50, zoom: 1 })
  })
})

describe('ảnh món: file và đường dẫn', () => {
  it('chỉ nhận JPG / PNG / WebP ≤ 15MB', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 3_000_000 })).toBeNull()
    expect(validateImageFile({ type: 'image/heic', size: 1000 })).toBe('Chỉ nhận ảnh JPG, PNG hoặc WebP')
    expect(validateImageFile({ type: 'image/png', size: 16 * 1024 * 1024 })).toBe('Ảnh quá lớn (tối đa 15MB)')
  })

  it('thu nhỏ cạnh dài về 1200px, không phóng ảnh nhỏ', () => {
    expect(fitSize(4000, 3000)).toEqual({ w: 1200, h: 900 })
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 })
  })

  it('đường dẫn trong bucket', () => {
    expect(imagePath('s1', 'p1', 123)).toBe('s1/p1-123.webp')
    const url = 'https://abc.supabase.co/storage/v1/object/public/product-images/s1/p1-123.webp'
    expect(storagePathFromUrl(url)).toBe('s1/p1-123.webp')
    expect(storagePathFromUrl(url + '?v=2')).toBe('s1/p1-123.webp')
    expect(storagePathFromUrl('/shop/matcha.jpg')).toBeNull()
    expect(storagePathFromUrl(null)).toBeNull()
  })

  it('thẻ món: ảnh tải lên ưu tiên hơn ảnh tĩnh', () => {
    expect(menuImage({ name: 'Matcha' })).toEqual({ src: '/shop/matcha.jpg', frame: { x: 50, y: 28, zoom: 1 } })
    expect(menuImage({ name: 'Matcha', image_url: 'https://x/a.webp', image_x: 10, image_y: 90, image_zoom: 2 })).toEqual({
      src: 'https://x/a.webp',
      frame: { x: 10, y: 90, zoom: 2 },
    })
    expect(menuImage({ name: 'Dâu tằm' })).toBeNull()
  })
})
