// Đọc bảng đầu tiên của file .xlsx thành mảng dòng × cột (số, chữ hoặc null).
// Viết riêng vì file xuất từ máy POS có kích thước zip ghi theo kiểu streaming và thư viện bảng tính đọc thiếu dòng.
import { unzipSync } from 'fflate'

const decoder = new TextDecoder('utf-8')

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k === 'amp') return '&'
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
  })

// Gộp mọi thẻ <t> (bỏ phiên âm <rPh>) của một ô chữ
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1]
  return unescapeXml(out)
}

// 'AB12' → 27 (chỉ số cột bắt đầu từ 0)
function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

export function readXlsxRows(bytes: Uint8Array): unknown[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) })
  const sheetName = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()))[0]
  if (!sheetName) throw new Error('File không có bảng dữ liệu nào')

  const shared: string[] = []
  const sst = files['xl/sharedStrings.xml']
  if (sst) for (const m of decoder.decode(sst).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]))

  const xml = decoder.decode(files[sheetName])
  const rows: unknown[][] = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rowMatch[1]
    const rIndex = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1
    const cells: unknown[] = []
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1]
      const col = ref ? colIndex(ref) : cells.length
      const type = c[1].match(/\bt="([^"]+)"/)?.[1]
      const body = c[2] ?? ''
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value: unknown = null
      if (type === 'inlineStr') value = textOf(body)
      else if (v !== undefined) {
        if (type === 's') value = shared[Number(v)] ?? null
        else if (type === 'str') value = unescapeXml(v)
        else if (type === 'b') value = v === '1'
        else if (type === 'e') value = null
        else value = Number(v)
      }
      while (cells.length < col) cells.push(null)
      cells[col] = value
    }
    while (rows.length < rIndex) rows.push([])
    rows[rIndex] = cells
  }
  return rows
}
