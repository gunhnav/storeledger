import fs from 'node:fs'
import path from 'node:path'

const distIndex = path.resolve('dist/index.html')
const distApp = path.resolve('dist/app.html')
const distShop = path.resolve('dist/shop.html')

if (!fs.existsSync(distIndex)) {
  console.error('dist/index.html not found, cannot generate shop.html')
  process.exit(1)
}

let html = fs.readFileSync(distIndex, 'utf8')

// Đổi index.html -> app.html để Vercel chạy rewrites theo host cho cả đường dẫn gốc "/"
fs.renameSync(distIndex, distApp)

// Thay thế favicon & meta tags Sổ Xanh thành Hogi Food cho trang đặt hàng
html = html
  .replace(
    /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/,
    '<link rel="icon" type="image/png" href="/shop/hogi-logo.png" />'
  )
  .replace(
    /<link rel="apple-touch-icon" href="\/favicon\.svg" \/>/,
    '<link rel="apple-touch-icon" href="/shop/hogi-logo.png" />'
  )
  .replace(
    /<title>.*?<\/title>/,
    '<title>Hogi Food – Đặt trước sữa chua &amp; bánh flan</title>'
  )
  .replace(
    /<meta name="description" content=".*?" \/>/,
    '<meta name="description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />'
  )
  .replace(
    /<meta property="og:url" content=".*?" \/>/,
    '<meta property="og:url" content="https://hogifood.vercel.app" />'
  )
  .replace(
    /<meta property="og:title" content=".*?" \/>/,
    '<meta property="og:title" content="Hogi Food – Đặt trước sữa chua &amp; bánh flan" />'
  )
  .replace(
    /<meta property="og:description" content=".*?" \/>/,
    '<meta property="og:description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />'
  )
  .replace(
    /<meta property="og:image" content=".*?" \/>/,
    '<meta property="og:image" content="https://hogifood.vercel.app/shop/truyenthong.jpg" />'
  )
  .replace(
    /<meta property="og:image:width" content=".*?" \/>/,
    '<meta property="og:image:width" content="1536" />'
  )
  .replace(
    /<meta property="og:image:height" content=".*?" \/>/,
    '<meta property="og:image:height" content="2048" />'
  )
  .replace(
    /<meta property="og:image:type" content=".*?" \/>/,
    '<meta property="og:image:type" content="image/jpeg" />'
  )
  .replace(
    /<meta name="twitter:title" content=".*?" \/>/,
    '<meta name="twitter:title" content="Hogi Food – Đặt trước sữa chua &amp; bánh flan" />'
  )
  .replace(
    /<meta name="twitter:description" content=".*?" \/>/,
    '<meta name="twitter:description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />'
  )
  .replace(
    /<meta name="twitter:image" content=".*?" \/>/,
    '<meta name="twitter:image" content="https://hogifood.vercel.app/shop/truyenthong.jpg" />'
  )

fs.writeFileSync(distShop, html, 'utf8')
console.log('✓ Generated dist/shop.html with Hogi Food Open Graph tags')
