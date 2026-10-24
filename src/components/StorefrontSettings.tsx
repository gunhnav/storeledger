import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorMessage } from '../lib/format'

type Settings = { is_public: boolean; public_phone: string; public_tagline: string }

// Cài đặt trang bán hàng công khai /shop/<mã quán> (chỉ admin; RLS stores_update_admin chặn người khác)
export function StorefrontSettings({ storeId, code }: { storeId: string; code: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const [form, setForm] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const link = `${window.location.origin}/shop/${code}`

  useEffect(() => {
    let cancelled = false
    supabase
      .from('stores')
      .select('is_public, public_phone, public_tagline')
      .eq('id', storeId)
      .single()
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) return setError(errorMessage(e))
        setForm({ is_public: data.is_public, public_phone: data.public_phone ?? '', public_tagline: data.public_tagline ?? '' })
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (error) return <p className="error">{t(error)}</p>
  if (!form) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('stores')
      .update({
        is_public: form.is_public,
        public_phone: form.public_phone.trim() || null,
        public_tagline: form.public_tagline.trim() || null,
      })
      .eq('id', storeId)
    setSaving(false)
    if (err) return setError(errorMessage(err))
    toast.success(t('Đã lưu cài đặt trang bán hàng'))
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('Đã sao chép liên kết'))
    } catch {
      window.prompt(t('Sao chép liên kết'), link)
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h3 className="card-title">{t('Trang bán hàng công khai')}</h3>
      <label className="check">
        <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
        {t('Bật trang bán hàng cho khách (không cần đăng nhập)')}
      </label>
      <label>
        {t('Số Zalo / hotline nhận đơn')}
        <input
          type="tel"
          inputMode="tel"
          value={form.public_phone}
          onChange={(e) => setForm({ ...form, public_phone: e.target.value })}
          placeholder="0901234567"
        />
      </label>
      <label>
        {t('Câu giới thiệu dưới tên quán')}
        <input
          type="text"
          maxLength={160}
          value={form.public_tagline}
          onChange={(e) => setForm({ ...form, public_tagline: e.target.value })}
          placeholder={t('Để trống để dùng câu mặc định')}
        />
      </label>
      <small className="muted">
        {t('Khách chỉ thấy món đang bán, giá và tình trạng còn / sắp hết / hết. Không hiện số lượng hay giá vốn.')}
      </small>
      {error && <p className="error">{t(error)}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? t('Đang lưu…') : t('Lưu cài đặt')}
        </button>
        {form.is_public && (
          <>
            <button type="button" onClick={copyLink}>
              {t('Sao chép liên kết')}
            </button>
            <a href={link} target="_blank" rel="noopener noreferrer">
              {t('Xem trang')}
            </a>
          </>
        )}
      </div>
    </form>
  )
}
