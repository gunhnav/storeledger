import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readXlsxRows } from './xlsxRead'

const book = (sheet: string, shared = '') => zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet), ...(shared ? { 'xl/sharedStrings.xml': strToU8(shared) } : {}) })

describe('đọc .xlsx', () => {
  it('đọc chữ chia sẻ, chữ trực tiếp, số, ô trống và dòng bị bỏ qua', () => {
    const rows = readXlsxRows(
      book(
        `<worksheet><sheetData>
          <row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><v>46318.5</v></c><c r="D2" t="inlineStr"><is><t>A &amp; B</t></is></c></row>
          <row r="4"><c r="B4" t="s"><v>1</v></c></row>
        </sheetData></worksheet>`,
        `<sst><si><t>Mã hóa đơn</t></si><si><r><t>Tổng </t></r><r><t>tiền</t></r></si></sst>`,
      ),
    )
    expect(rows[0]).toEqual([])
    expect(rows[1]).toEqual(['Mã hóa đơn', null, 46318.5, 'A & B'])
    expect(rows[2]).toEqual([])
    expect(rows[3]).toEqual([null, 'Tổng tiền'])
  })

  it('báo lỗi khi file không có bảng', () => {
    expect(() => readXlsxRows(zipSync({ 'readme.txt': strToU8('x') }))).toThrow('bảng dữ liệu')
  })
})
