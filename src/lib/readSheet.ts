// Đọc file Excel (.xlsx / .xls) thành mảng dòng × cột. Thư viện .xls chỉ nạp khi cần để không làm nặng trang chính.
import { readXlsxRows } from './xlsxRead'

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

export async function readSheet(file: File): Promise<unknown[][]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File quá lớn (tối đa 8 MB)')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // .xlsx là file zip (bắt đầu bằng "PK"); còn lại coi là .xls cũ
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsxRows(bytes)
  const XLSX = await import('xlsx')
  const wb = XLSX.read(bytes, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('File không có bảng dữ liệu nào')
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
}
