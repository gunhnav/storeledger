import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { LOCAL_BUILD_ID, fetchRemoteBuildId, isOutdated } from '../lib/appVersion'

const CHECK_EVERY_MS = 5 * 60 * 1000
const RELOADED_KEY = 'web-nhap-lieu.reloaded-for'

// Mỗi bản server được tải lại tự động tối đa một lần (tránh vòng lặp reload nếu CDN còn trả bản cũ)
function reloadOnce(remote: string | null): boolean {
  try {
    if (remote && sessionStorage.getItem(RELOADED_KEY) === remote) return false
    if (remote) sessionStorage.setItem(RELOADED_KEY, remote)
  } catch {
    // Không dùng được sessionStorage: vẫn tải lại
  }
  window.location.reload()
  return true
}

// Ép người dùng đang mở tab cũ sang bản mới sau mỗi lần deploy:
//  - mở app / quay lại tab / mỗi 5 phút: hỏi /version.json; khác bản đang chạy thì tải lại ngay nếu tab đang ẩn hoặc vừa mở,
//    còn đang dùng thì hiện thanh "Có bản mới" để họ tự bấm (không mất dữ liệu đang nhập)
//  - tải chunk lỗi sau deploy (file cũ không còn): tải lại luôn
export function UpdateWatcher() {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let first = true
    const check = async () => {
      const remote = await fetchRemoteBuildId()
      if (!isOutdated(LOCAL_BUILD_ID, remote)) return
      if (first || document.hidden) {
        if (reloadOnce(remote)) return
      }
      setPending(true)
    }
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    const onPreloadError = (e: Event) => {
      e.preventDefault()
      reloadOnce(null)
    }
    void check().finally(() => {
      first = false
    })
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('vite:preloadError', onPreloadError)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('vite:preloadError', onPreloadError)
    }
  }, [])

  if (!pending) return null
  return (
    <div className="update-banner" role="status">
      <span>{t('Có phiên bản mới của ứng dụng.')}</span>
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        {t('Tải lại')}
      </button>
    </div>
  )
}
