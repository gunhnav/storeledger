// Kiểm tra bản dịch: mọi chuỗi tiếng Việt trong src/ (khoá của t()) phải có trong src/i18n/{en,ko,zh,ja}.ts
// Chạy: yarn i18n:check (thoát mã 1 nếu thiếu)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const VN = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸ]/
// Không phải chữ hiển thị: dữ liệu ghi vào DB, log console, tên thương hiệu / ngôn ngữ
const IGNORE = new Set(['Giá ban đầu', 'Tự vào quán khi nhập hàng', 'Lấy từ quán cho công ty', 'Lỗi giao diện:', 'Sổ Xanh', 'Tiếng Việt', 'đ', 'Đ'])
const EXTRA = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'Email']

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'i18n') walk(p)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
  }
}
walk('src')

const keys = new Set(EXTRA)
for (const f of files) {
  let s = readFileSync(f, 'utf8')
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1')
  for (const m of s.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    const text = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    const before = s.slice(Math.max(0, m.index - 40), m.index)
    if (/new Error\($/.test(before.trimEnd())) continue
    if (VN.test(text) || (/\bt\($/.test(before.trimEnd()) && text.trim())) keys.add(text)
  }
  for (const m of s.matchAll(/"([^"\n]*)"/g)) if (VN.test(m[1])) keys.add(m[1])
}
for (const k of IGNORE) keys.delete(k)

let missingTotal = 0
for (const lang of ['en', 'ko', 'zh', 'ja']) {
  const dict = readFileSync(`src/i18n/${lang}.ts`, 'utf8')
  const have = new Set([...dict.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')))
  const missing = [...keys].filter((k) => !have.has(k))
  missingTotal += missing.length
  if (missing.length) console.log(`[${lang}] thiếu ${missing.length}:\n  ` + missing.join('\n  '))
}
console.log(`${keys.size} khoá, thiếu tổng cộng ${missingTotal}`)
process.exit(missingTotal ? 1 : 0)
