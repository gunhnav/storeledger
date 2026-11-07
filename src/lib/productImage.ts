// Ảnh món trang đặt hàng: logic thuần (kiểm tra file, nén ảnh, căn chỉnh khung). Tải lên Storage ở productImageUpload.ts.
// Ảnh gốc được giữ nguyên; khung hiển thị chỉ là điểm căn (x, y theo %, như object-position) + độ phóng,
// nên admin căn chỉnh lại lúc nào cũng được mà không mất phần ảnh bị che.
import type { CSSProperties } from 'react'

export const PRODUCT_IMAGE_BUCKET = 'product-images'
export const MAX_INPUT_BYTES = 15 * 1024 * 1024
// Cạnh dài tối đa sau khi nén: đủ nét cho thẻ món ~260px trên màn hình 3x
export const OUTPUT_MAX_SIDE = 1200
export const OUTPUT_QUALITY = 0.85
export const ZOOM_MIN = 1
export const ZOOM_MAX = 3
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPT_ATTR = ACCEPTED.join(',')

export type ImageFrame = { x: number; y: number; zoom: number }
export const DEFAULT_FRAME: ImageFrame = { x: 50, y: 50, zoom: 1 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

export function clampFrame(f: ImageFrame): ImageFrame {
  return {
    x: round2(clamp(Number.isFinite(f.x) ? f.x : 50, 0, 100)),
    y: round2(clamp(Number.isFinite(f.y) ? f.y : 50, 0, 100)),
    zoom: round2(clamp(Number.isFinite(f.zoom) ? f.zoom : 1, ZOOM_MIN, ZOOM_MAX)),
  }
}

// 'center 28%' / 'left top' / '30% 70%' -> { x, y } (giá trị object-position)
export function parsePosition(pos: string): { x: number; y: number } {
  const word: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }
  const parts = pos.trim().split(/\s+/)
  const val = (p: string | undefined) => {
    if (p === undefined) return 50
    if (p in word) return word[p]
    const n = parseFloat(p)
    return Number.isFinite(n) ? clamp(n, 0, 100) : 50
  }
  return { x: val(parts[0]), y: val(parts[1]) }
}

// Khung đã lưu trong DB (null = chưa căn) hoặc khung mặc định theo object-position
export function frameFrom(
  saved: { image_x?: number | null; image_y?: number | null; image_zoom?: number | null },
  fallbackPosition: string,
): ImageFrame {
  if (saved.image_x == null || saved.image_y == null) return { ...parsePosition(fallbackPosition), zoom: 1 }
  return clampFrame({ x: Number(saved.image_x), y: Number(saved.image_y), zoom: Number(saved.image_zoom ?? 1) })
}

// Style cho <img> có object-fit: cover; CSS dùng biến --img-zoom để phóng (kể cả hiệu ứng hover)
export function frameStyle(f: ImageFrame): CSSProperties {
  const pos = `${f.x}% ${f.y}%`
  return { objectPosition: pos, transformOrigin: pos, '--img-zoom': f.zoom } as CSSProperties
}

// Kéo ảnh trong khung box (px) đi dx, dy: tính lại điểm căn.
// Ảnh phủ kín khung (cover) nên chỉ dịch được theo phần dư; phóng to thì có thêm phần dư do zoom.
export function panFrame(
  f: ImageFrame,
  dx: number,
  dy: number,
  box: { w: number; h: number },
  img: { w: number; h: number },
): ImageFrame {
  if (box.w <= 0 || box.h <= 0 || img.w <= 0 || img.h <= 0) return f
  const s = Math.max(box.w / img.w, box.h / img.h)
  const ox = img.w * s - box.w
  const oy = img.h * s - box.h
  const rangeX = ox * f.zoom + box.w * (f.zoom - 1)
  const rangeY = oy * f.zoom + box.h * (f.zoom - 1)
  return clampFrame({
    x: rangeX < 1 ? f.x : f.x - (dx / rangeX) * 100,
    y: rangeY < 1 ? f.y : f.y - (dy / rangeY) * 100,
    zoom: f.zoom,
  })
}

// null = hợp lệ; ngược lại là thông báo lỗi (khoá i18n)
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Chỉ nhận ảnh JPG, PNG hoặc WebP'
  if (file.size > MAX_INPUT_BYTES) return 'Ảnh quá lớn (tối đa 15MB)'
  return null
}

// Kích thước sau khi thu nhỏ để cạnh dài ≤ max (không phóng to ảnh nhỏ)
export function fitSize(w: number, h: number, max = OUTPUT_MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

// Đường dẫn file trong bucket: <store_id>/<product_id>-<thời điểm>.webp (tên mới mỗi lần để không dính cache CDN)
export const imagePath = (storeId: string, productId: string, now = Date.now()) => `${storeId}/${productId}-${now}.webp`

// URL public của Supabase Storage -> đường dẫn trong bucket product-images (null nếu là ảnh tĩnh / chỗ khác)
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`
  const i = url.indexOf(marker)
  if (i < 0) return null
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0])
  return path === '' ? null : path
}

// Trình duyệt: đọc ảnh, xoay (bội số 90°), thu nhỏ rồi nén WebP. Ảnh điện thoại 3-5MB còn khoảng 100-200KB.
export async function processImage(file: Blob, rotation = 0): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const turns = (((Math.round(rotation / 90) % 4) + 4) % 4)
    const size = fitSize(bitmap.width, bitmap.height)
    const swap = turns % 2 === 1
    const canvas = document.createElement('canvas')
    canvas.width = swap ? size.h : size.w
    canvas.height = swap ? size.w : size.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh')
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(bitmap, -size.w / 2, -size.h / 2, size.w, size.h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', OUTPUT_QUALITY))
    if (!blob) throw new Error('Không nén được ảnh, thử ảnh khác')
    return blob
  } finally {
    bitmap.close()
  }
}
