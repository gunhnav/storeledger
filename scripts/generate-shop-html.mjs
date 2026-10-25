import fs from 'node:fs'
import path from 'node:path'

const distIndex = path.resolve('dist/index.html')
const distShop = path.resolve('dist/shop.html')

if (!fs.existsSync(distIndex)) {
  console.error('dist/index.html not found, cannot generate shop.html')
  process.exit(1)
}

let html = fs.readFileSync(distIndex, 'utf8')

// Thay thế meta tags Sổ Xanh thành Hogi Food cho trang đặt hàng /shop/*
html = html
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
    '<meta property="og:url" content="https://storeledger-one.vercel.app/shop/hogi" />'
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
    '<meta property="og:image" content="https://storeledger-one.vercel.app/shop/truyenthong.jpg" />'
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
    '<meta name="twitter:image" content="https://storeledger-one.vercel.app/shop/truyenthong.jpg" />'
  )

fs.writeFileSync(distShop, html, 'utf8')
console.log('✓ Generated dist/shop.html with Hogi Food Open Graph tags')
