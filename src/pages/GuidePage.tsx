import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'

type Section = {
  icon: IconName
  title: string
  items: string[]
  // Đường tới trang liên quan
  link?: { to: string; label: string }
  // Nội dung có giá vốn / lãi / chi phí: chỉ admin thấy
  adminOnly?: boolean
}

const STEPS: { icon: IconName; title: string; text: string; to: string }[] = [
  { icon: 'purchase', title: 'Nhập hàng', text: 'Ghi số hũ mỗi loại vừa mua về. Hàng vào kho ở nhà.', to: '/inventory/purchases' },
  { icon: 'transfer', title: 'Phân phối', text: 'Ghi số hũ mang từ nhà ra quán hoặc cho công ty. Hàng chuyển sang tồn tại quán / công ty.', to: '/inventory/transfers' },
  { icon: 'sale', title: 'Bán hàng', text: 'Bấm món, chọn kênh bán rồi lưu đơn. Hàng trừ ở quán.', to: '/sales' },
]

const SECTIONS: Section[] = [
  {
    icon: 'sale',
    title: 'Bán hàng',
    items: [
      'Chọn kênh bán trước khi bấm món: “Quán” hoặc “Công ty” (Bún đậu: “Quán” hoặc “Đối tác”); giá tự lấy theo kênh và ngày bán.',
      'Kênh “Công ty”: trước tiên vào Kho hàng → Phân phối → Cho công ty, nhập theo set 4 / set 6 (mỗi set mix nhiều vị). Khi bán, nhập số set, giá 1 set và tổng số hũ từng vị; hàng trừ vào phần đã phân phối cho công ty.',
      'Món nào chưa có ở quán thì phân phối trước rồi mới bán, để tồn tại quán không bị âm.',
      'Ghi đơn ngay khi bán. Nếu quên, đổi ngày bán sang đúng ngày rồi lưu.',
    ],
    link: { to: '/sales', label: 'Mở Bán hàng' },
  },
  {
    icon: 'stock',
    title: 'Cảnh báo hết / sắp hết',
    items: [
      'Đỏ “HẾT HÀNG TẠI CỬA HÀNG”: quán còn 0 hũ → phân phối thêm từ nhà ra quán ngay.',
      'Cam “SẮP HẾT”: tồn tại quán đã chạm ngưỡng báo của món (mặc định 3 hũ).',
      'Đỏ “KIỂM TRA số liệu”: tồn bị âm, thường do bán khi chưa ghi chuyển hàng hoặc nhập sai số. Báo admin để sửa.',
      '“Chưa mang ra”: món đã nhập nhưng chưa phân phối hũ nào ra quán.',
    ],
    link: { to: '/inventory/stock', label: 'Mở Tồn kho' },
  },
  {
    icon: 'product',
    title: 'Đổi giá có lịch sử',
    items: [
      'Vào Quản lý → Sản phẩm, bấm “Đổi giá” ở món cần đổi và chọn ngày bắt đầu áp dụng.',
      'Giá cũ không bị xoá: mỗi lần đổi là một dòng trong “Lịch sử giá”. Đơn bán ngày nào tính theo giá có hiệu lực ngày đó.',
      'Mỗi đơn bán chụp lại giá bán và giá vốn lúc bán, nên đổi giá sau này không làm sai báo cáo cũ.',
      'Đổi giá vốn hàng loạt giữ nguyên giá bán, chỉ thay giá vốn từ ngày áp dụng.',
    ],
    link: { to: '/manage/products', label: 'Mở Sản phẩm' },
    adminOnly: true,
  },
  {
    icon: 'log',
    title: 'Số “luỹ kế” là gì?',
    items: [
      'Luỹ kế = cộng dồn từ giao dịch đầu tiên của cửa hàng đến ngày đang xem, không chỉ riêng khoảng ngày đã chọn.',
      'Ví dụ doanh thu ngày 1 là 100.000đ, ngày 2 là 50.000đ thì doanh thu luỹ kế đến ngày 2 là 150.000đ.',
      'Doanh thu thuần đã trừ hoa hồng ShopeeFood / đối tác.',
    ],
    link: { to: '/reports/daily-log', label: 'Mở Nhật ký ngày' },
    adminOnly: true,
  },
  {
    icon: 'purchase',
    title: 'Đọc Thống kê theo đợt nhập (FIFO)',
    items: [
      'Mỗi đợt nhập là một dòng. Hũ bán ra được trừ vào đợt cũ nhất còn hàng trước (vào trước – ra trước).',
      'Doanh thu và giá vốn của từng hũ được gán đúng cho đợt đã cấp hũ đó, nên mỗi đợt có lãi gộp riêng.',
      '“% vốn thu hồi” = doanh thu của đợt ÷ vốn nhập của đợt. Đạt 100% là đợt đã hoàn vốn.',
      '“Lãi/lỗ nếu bán hết” = cả đợt bán hết theo giá hiện hành trừ vốn nhập của đợt.',
    ],
    link: { to: '/reports/batches', label: 'Mở Theo đợt nhập' },
    adminOnly: true,
  },
  {
    icon: 'report',
    title: 'Hoà vốn',
    items: [
      'Tổng đã chi = tiền nhập hàng + chi phí đồ dùng.',
      'Hoà vốn khi doanh thu thuần luỹ kế ≥ tổng đã chi; ngày đạt mốc đó là ngày hoà vốn.',
      'Chưa hoà vốn thì app dự kiến ngày hoà vốn bằng doanh thu trung bình mỗi ngày.',
      'Chi phí đồ dùng nhập ở Quản lý → Chi phí: số lượng × đơn giá, có thể ghi đè thành tiền.',
    ],
    link: { to: '/reports/overview', label: 'Mở Tổng quan' },
    adminOnly: true,
  },
]

// Hướng dẫn sử dụng: mọi vai trò xem được, phần tiền vốn / lãi chỉ hiện cho admin
export function GuidePage() {
  const { isAdmin } = useAuth()
  const { t } = useI18n()
  const sections = SECTIONS.filter((s) => isAdmin || !s.adminOnly)

  return (
    <section className="guide">
      <h2>{t('Hướng dẫn')}</h2>
      <p className="muted">{t('Hàng đi theo 3 bước. Ghi đủ cả 3 bước thì tồn kho và cảnh báo mới đúng.')}</p>
      <ol className="guide-steps">
        {STEPS.map((step, i) => (
          <li key={step.to}>
            <Link to={step.to} className="guide-step card">
              <span className="guide-step-num">{i + 1}</span>
              <Icon name={step.icon} size={22} />
              <strong>{t(step.title)}</strong>
              <span className="muted">{t(step.text)}</span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="guide-grid">
        {sections.map((s) => (
          <article key={s.title} className="card guide-card">
            <h3>
              <Icon name={s.icon} />
              {t(s.title)}
            </h3>
            <ul>
              {s.items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
            {s.link && (
              <Link to={s.link.to} className="guide-link">
                {t(s.link.label)} →
              </Link>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
