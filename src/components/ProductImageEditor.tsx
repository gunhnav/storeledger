// Ảnh món cho trang đặt hàng: chọn ảnh, xoay, kéo để căn, phóng to, xem trước thẻ máy tính + điện thoại.
// Chỉ admin mở được (trang Sản phẩm bọc RequireAdmin); Storage + bảng products cũng chặn ghi bằng RLS.
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { errorMessage } from '../lib/format'
import { flavorEmoji, flavorImage, flavorPosition } from '../lib/storefront'
import {
  ACCEPT_ATTR,
  DEFAULT_FRAME,
  ZOOM_MAX,
  ZOOM_MIN,
  clampFrame,
  frameFrom,
  frameStyle,
  panFrame,
  processImage,
  validateImageFile,
  type ImageFrame,
} from '../lib/productImage'
import { removeProductImage, uploadProductImage } from '../lib/productImageUpload'
import type { Product } from '../types/database'

type Pending = { original: File; rotation: number; blob: Blob; url: string }

export function ProductImageEditor({
  product,
  storeId,
  onSaved,
  onClose,
}: {
  product: Product
  storeId: string
  onSaved: (text: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const fallback = flavorImage(product.name)
  const [pending, setPending] = useState<Pending | null>(null)
  const [frame, setFrame] = useState<ImageFrame>(() => frameFrom(product, flavorPosition(product.name)))
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState<'process' | 'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const src = pending?.url ?? product.image_url ?? fallback

  // Giải phóng object URL của ảnh xem trước cũ
  useEffect(() => {
    if (!pending) return
    const url = pending.url
    return () => URL.revokeObjectURL(url)
  }, [pending])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && busy === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const prepare = async (original: File, rotation: number) => {
    setBusy('process')
    setError(null)
    try {
      const blob = await processImage(original, rotation)
      setNatural(null)
      setPending({ original, rotation, blob, url: URL.createObjectURL(blob) })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const onPick = (file: File | undefined) => {
    if (!file) return
    const invalid = validateImageFile(file)
    if (invalid) return setError(invalid)
    setFrame(DEFAULT_FRAME)
    void prepare(file, 0)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!src) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const box = frameRef.current
    if (!d || d.id !== e.pointerId || !box || !natural) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    drag.current = { id: d.id, x: e.clientX, y: e.clientY }
    setFrame((f) => panFrame(f, dx, dy, { w: box.clientWidth, h: box.clientHeight }, natural))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }
  // Phím mũi tên dịch 2% (giữ Shift: 10%), +/- để phóng
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2
    const moves: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 0],
      ArrowRight: [step, 0, 0],
      ArrowUp: [0, -step, 0],
      ArrowDown: [0, step, 0],
      '+': [0, 0, 0.1],
      '=': [0, 0, 0.1],
      '-': [0, 0, -0.1],
    }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    setFrame((f) => clampFrame({ x: f.x + m[0], y: f.y + m[1], zoom: f.zoom + m[2] }))
  }

  const save = async () => {
    setBusy('save')
    setError(null)
    let uploaded: string | null = null
    try {
      if (pending) uploaded = await uploadProductImage(pending.blob, storeId, product.id)
      const f = clampFrame(frame)
      const { data, error: e } = await supabase
        .from('products')
        .update({ image_url: uploaded ?? product.image_url, image_x: f.x, image_y: f.y, image_zoom: f.zoom })
        .eq('id', product.id)
        .select('id')
      if (e) throw e
      if (!data || data.length === 0) throw new Error('Chỉ quản trị viên được tải ảnh món')
      // Ảnh mới đã lưu: xoá file cũ trong bucket (lỗi thì bỏ qua, chỉ tốn chút dung lượng)
      if (uploaded && product.image_url) await removeProductImage(product.image_url).catch(() => undefined)
      onSaved(t('Đã lưu ảnh "{name}"', { name: product.name }))
    } catch (e) {
      if (uploaded) await removeProductImage(uploaded).catch(() => undefined)
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  const removeImage = async () => {
    setBusy('delete')
    setError(null)
    try {
      const { error: e } = await supabase
        .from('products')
        .update({ image_url: null, image_x: null, image_y: null, image_zoom: null })
        .eq('id', product.id)
      if (e) throw e
      await removeProductImage(product.image_url).catch(() => undefined)
      onSaved(t('Đã xoá ảnh "{name}"', { name: product.name }))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  const style = frameStyle(frame)
  const art = (cls: string, main: boolean) => (
    <div
      ref={main ? frameRef : undefined}
      className={`img-frame ${cls}`}
      tabIndex={main ? 0 : undefined}
      role={main ? 'application' : undefined}
      aria-label={main ? t('Kéo ảnh để căn chỉnh, phím mũi tên để dịch, +/- để phóng') : undefined}
      onPointerDown={main ? onPointerDown : undefined}
      onPointerMove={main ? onPointerMove : undefined}
      onPointerUp={main ? onPointerUp : undefined}
      onPointerCancel={main ? onPointerUp : undefined}
      onKeyDown={main ? onKeyDown : undefined}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={style}
          onLoad={main ? (e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) : undefined}
        />
      ) : (
        <span>{flavorEmoji(product.name)}</span>
      )}
    </div>
  )

  return (
    <div className="confirm-backdrop" onClick={() => busy === null && onClose()}>
      <div
        className="confirm-modal img-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="img-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="img-editor-title" className="confirm-title">
          {t('Ảnh món: {name}', { name: product.name })}
        </h3>
        <small className="muted">
          {pending
            ? t('Ảnh mới (đã nén {size} KB), chưa lưu.', { size: Math.round(pending.blob.size / 1024) })
            : product.image_url
              ? t('Ảnh đã tải lên. Kéo để căn lại hoặc chọn ảnh khác.')
              : fallback
                ? t('Đang dùng ảnh mặc định theo tên món. Kéo để căn hoặc chọn ảnh riêng.')
                : t('Món chưa có ảnh, trang đặt hàng đang hiện biểu tượng. Chọn ảnh để thêm.')}
        </small>

        <div className="img-editor-previews">
          <figure>
            {art('is-main', true)}
            <figcaption>{t('Thẻ món trên máy tính (kéo để căn)')}</figcaption>
          </figure>
          <figure>
            {art('is-mobile', false)}
            <figcaption>{t('Trên điện thoại')}</figcaption>
          </figure>
        </div>

        <label className="img-editor-zoom">
          {t('Phóng to')}
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={frame.zoom}
            disabled={!src}
            onChange={(e) => setFrame((f) => clampFrame({ ...f, zoom: Number(e.target.value) }))}
          />
          <span>{Math.round(frame.zoom * 100)}%</span>
        </label>

        <div className="img-editor-actions">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            hidden
            onChange={(e) => {
              onPick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button type="button" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === 'process' ? t('Đang xử lý ảnh…') : src ? t('Chọn ảnh khác') : t('Chọn ảnh')}
          </button>
          {pending && (
            <button type="button" disabled={busy !== null} onClick={() => void prepare(pending.original, pending.rotation + 90)}>
              {t('Xoay 90°')}
            </button>
          )}
          <button type="button" disabled={busy !== null || !src} onClick={() => setFrame(DEFAULT_FRAME)}>
            {t('Căn giữa')}
          </button>
          {product.image_url && !pending && (
            <button type="button" className="danger" disabled={busy !== null} onClick={() => void removeImage()}>
              {busy === 'delete' ? t('Đang xoá…') : t('Xoá ảnh')}
            </button>
          )}
        </div>

        {error && <p className="error">{t(error)}</p>}

        <div className="img-editor-actions">
          <span className="spacer" />
          <button type="button" disabled={busy !== null} onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button type="button" className="primary" disabled={busy !== null || !src} onClick={() => void save()}>
            {busy === 'save' ? t('Đang lưu…') : t('Lưu ảnh')}
          </button>
        </div>
      </div>
    </div>
  )
}
