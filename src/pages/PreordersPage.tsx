import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { useToast } from '../lib/toast'
import { useConfirm } from '../lib/confirm'
import { errorMessage, formatDate, formatVND } from '../lib/format'
import { NEXT_STATUS, PREORDER_STATUSES, STATUS_LABEL, itemsToPrepare, summarizePreorders } from '../lib/preorders'
import type { Preorder, PreorderStatus } from '../types/database'

const time = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Đơn đặt trước từ trang khách (chỉ admin). Bảng riêng, không cộng vào bán hàng / kho / báo cáo của app.
// Tự cập nhật khi có đơn mới hoặc đơn đổi trạng thái (Supabase Realtime).
export function PreordersPage() {
  const { current } = useStore()
  return current ? <Preorders key={current.id} storeId={current.id} /> : null
}

function Preorders({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Preorder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PreorderStatus | 'open' | 'all'>('open')
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))

  useEffect(() => {
    let cancelled = false
    supabase
      .from('preorders')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) return setError(errorMessage(e))
        setRows(data)
      })
    return () => {
      cancelled = true
    }
  }, [storeId, version])

  // Tải lại khi có đơn mới / đổi trạng thái
  useEffect(() => {
    const channel = supabase
      .channel(`preorders-page-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'preorders', filter: `store_id=eq.${storeId}` }, () => setVersion((v) => v + 1))
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  const setStatus = async (order: Preorder, status: PreorderStatus) => {
    setBusy(order.id)
    const { error: e } = await supabase.from('preorders').update({ status }).eq('id', order.id)
    setBusy(null)
    if (e) return toast.error(errorMessage(e))
    toast.success(t('Đơn {code}: {status}', { code: order.code, status: t(STATUS_LABEL[status]) }))
    setVersion((v) => v + 1)
  }

  const cancelOrder = async (order: Preorder) => {
    const ok = await confirm({
      title: t('Huỷ đơn {code}?', { code: order.code }),
      message: t('Bạn có chắc muốn huỷ đơn {code}? Khách và quán sẽ thấy trạng thái đơn đã huỷ.', { code: order.code }),
      confirmText: t('Huỷ đơn'),
      cancelText: t('Đóng'),
      danger: true,
    })
    if (ok) setStatus(order, 'cancelled')
  }

  const askPermission = async () => {
    if (!('Notification' in window)) return
    setPermission(await Notification.requestPermission())
  }

  if (error) return <p className="error">{t(error)}</p>
  if (!rows) return <p className="muted">{t('Đang tải…')}</p>

  const { counts, openTotal } = summarizePreorders(rows)
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? r.status !== 'delivered' && r.status !== 'cancelled' : r.status === filter))
  const prepare = itemsToPrepare(rows)

  return (
    <section className="report-stack">
      <h2>{t('Đơn đặt trước')}</h2>
      <p className="muted">{t('Đơn khách đặt trên trang khách. Lưu riêng, không tính vào bán hàng, tồn kho hay báo cáo. Đơn mới tự hiện và có thông báo.')}</p>
      {permission === 'default' && (
        <div className="row">
          <button type="button" onClick={askPermission}>
            {t('Bật thông báo trên trình duyệt')}
          </button>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="stat-label">{t('Đơn mới')}</div>
          <div className="stat-value">{counts.new}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Chờ thanh toán / giao')}</div>
          <div className="stat-value">{counts.confirmed + counts.paid}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Tiền các đơn đang mở')}</div>
          <div className="stat-value">{formatVND(openTotal)}</div>
        </div>
      </div>

      {prepare.length > 0 && (
        <section className="report-block">
          <h3>{t('Cần chuẩn bị (đơn chưa giao)')}</h3>
          <ul className="prepare-list">
            {prepare.map((p) => (
              <li key={p.title}>
                <strong>{p.qty}</strong> × {p.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="preset-chips" role="group" aria-label={t('Lọc đơn')}>
        {(['open', ...PREORDER_STATUSES, 'all'] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? 'active' : undefined} onClick={() => setFilter(f)}>
            {f === 'open' ? t('Đang mở') : f === 'all' ? t('Tất cả') : `${t(STATUS_LABEL[f])} (${counts[f]})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">{t('Chưa có đơn nào.')}</p>
      ) : (
        <div className="preorder-list">
          {shown.map((o) => {
            const next = NEXT_STATUS[o.status]
            return (
              <article key={o.id} className={`card preorder preorder-${o.status}`}>
                <div className="preorder-head">
                  <div>
                    <strong>{o.code}</strong> <span className={`badge preorder-badge-${o.status}`}>{t(STATUS_LABEL[o.status])}</span>
                    <div className="muted">
                      {formatDate(o.created_at.slice(0, 10))} {time(o.created_at)} ·{' '}
                      {(() => {
                        const name = o.customer_name?.trim()
                        const domain = o.customer_domain?.trim()
                        if (!name || name.toLowerCase() === domain?.toLowerCase()) {
                          return domain || name
                        }
                        return `${name} (${domain})`
                      })()}{' '}
                      · {t('Tầng {floor}', { floor: o.floor })}
                    </div>
                  </div>
                  <strong className="preorder-total">{formatVND(Number(o.total))}</strong>
                </div>
                <ul className="preorder-lines">
                  {o.lines.map((l, i) => (
                    <li key={i}>
                      {l.qty} × {l.title}
                      {l.kind === 'set' && <span className="muted"> ({l.detail})</span>}
                      {o.lines.length > 1 && ` · ${formatVND(Number(l.unit_price) * l.qty)}`}
                    </li>
                  ))}
                </ul>
                <div className="row">
                  <span className="muted">{o.payment === 'transfer' ? t('Chuyển khoản') : t('Tiền mặt khi nhận')}</span>
                  {next && (
                    <button type="button" className="primary" disabled={busy === o.id} onClick={() => setStatus(o, next)}>
                      {o.status === 'new' ? t('Nhận đơn') : t('Chuyển sang: {status}', { status: t(STATUS_LABEL[next]) })}
                    </button>
                  )}
                  {o.status !== 'cancelled' && o.status !== 'delivered' && (
                    <button type="button" className="link danger" disabled={busy === o.id} onClick={() => cancelOrder(o)}>
                      {t('Huỷ đơn')}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
