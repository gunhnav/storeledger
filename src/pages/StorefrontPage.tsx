import { useState } from 'react'
import { StorefrontSettings } from '../components/StorefrontSettings'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'

// Cài đặt trang bán hàng công khai của quán (chỉ admin) kèm khung xem trước đúng như khách thấy
export function StorefrontPage() {
  const { current } = useStore()
  return current ? <Storefront key={current.id} storeId={current.id} code={current.code} isPublic={current.is_public} /> : null
}

function Storefront({ storeId, code, isPublic }: { storeId: string; code: string; isPublic: boolean }) {
  const { t } = useI18n()
  // Tải lại khung xem trước sau khi lưu cài đặt
  const [version, setVersion] = useState(0)
  return (
    <section>
      <h2>{t('Trang bán hàng công khai')}</h2>
      <p className="muted">{t('Trang khách đặt trước theo set, không cần đăng nhập. Thực đơn và giá lấy tự động từ danh sách sản phẩm.')}</p>
      <div className="storefront-grid">
        <StorefrontSettings storeId={storeId} code={code} onSaved={() => setVersion((v) => v + 1)} />
        <div className="card storefront-preview">
          <h3 className="card-title">{t('Xem trước')}</h3>
          {isPublic ? (
            <iframe key={version} title={t('Xem trước')} src={`/shop/${code}`} loading="lazy" />
          ) : (
            <p className="muted">{t('Bật trang bán hàng rồi lưu cài đặt để xem trước.')}</p>
          )}
        </div>
      </div>
    </section>
  )
}
