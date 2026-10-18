// Phân phối cho Công ty theo set: mỗi nhóm là "N set cỡ 4 hoặc 6", trong mỗi set mix nhiều vị.
// Tổng hũ từng vị = Σ (số hũ vị đó trong 1 set × số set). Chỉ số lượng, không có giá vốn.

export const SET_SIZES = [4, 6] as const
export type SetSize = (typeof SET_SIZES)[number]

export type SetGroup = {
  id: string
  size: SetSize
  count: number
  // số hũ mỗi vị trong 1 set
  mix: Record<string, number>
}

export type SetGroupIssue = 'count' | 'mix_short' | 'mix_over' | 'mix_invalid'

export const mixTotal = (g: SetGroup) => Object.values(g.mix).reduce((s, n) => s + (n || 0), 0)

// Lỗi của một nhóm set: số set không hợp lệ, hoặc tổng vị trong 1 set khác cỡ set
export function groupIssue(g: SetGroup): SetGroupIssue | null {
  if (!Number.isInteger(g.count) || g.count <= 0) return 'count'
  if (Object.values(g.mix).some((n) => !Number.isInteger(n) || n < 0)) return 'mix_invalid'
  const total = mixTotal(g)
  if (total < g.size) return 'mix_short'
  if (total > g.size) return 'mix_over'
  return null
}

// Tổng hũ cần phân phối cho từng vị (bỏ qua nhóm lỗi để không tính sai)
export function setTotals(groups: SetGroup[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const g of groups) {
    if (groupIssue(g)) continue
    for (const [productId, n] of Object.entries(g.mix)) {
      if (n > 0) totals.set(productId, (totals.get(productId) ?? 0) + n * g.count)
    }
  }
  return totals
}

// Ghi chú lưu kèm lần phân phối, ví dụ "5 set 4 (2 Truyền thống + 2 Cacao) + 3 set 6 (...)"
export function describeSets(groups: SetGroup[], names: Map<string, string>): string {
  return groups
    .filter((g) => !groupIssue(g))
    .map((g) => {
      const parts = Object.entries(g.mix)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `${n} ${names.get(id) ?? id}`)
      return `${g.count} set ${g.size} (${parts.join(' + ')})`
    })
    .join(' + ')
}

// Vị nào cần nhiều hơn số đang ở nhà
export function overHomeSets(totals: Map<string, number>, home: Map<string, number>): { productId: string; want: number; home: number }[] {
  return [...totals]
    .map(([productId, want]) => ({ productId, want, home: home.get(productId) ?? 0 }))
    .filter((r) => r.want > r.home)
}

// ---- Bán kênh Công ty theo các set đã phân phối ----

export type CompanySetRow = { set_size: number; set_count: number; mix: Record<string, number> }
export type SetKind = { key: string; size: number; mix: Record<string, number>; distributed: number }

// Khoá của một loại set: cỡ + thành phần (bỏ vị 0, sắp theo mã món) để gộp các lần phân phối giống nhau
export function setKey(size: number, mix: Record<string, number>): string {
  const parts = Object.entries(mix)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}:${n}`)
  return `${size}|${parts.join(',')}`
}

// Gộp các nhóm set đã phân phối thành từng loại set, kèm tổng số set đã phân phối
export function setKinds(rows: CompanySetRow[]): SetKind[] {
  const kinds = new Map<string, SetKind>()
  for (const r of rows) {
    const key = setKey(r.set_size, r.mix)
    const kind = kinds.get(key)
    if (kind) kind.distributed += r.set_count
    else kinds.set(key, { key, size: r.set_size, mix: r.mix, distributed: r.set_count })
  }
  return [...kinds.values()]
}

export type SetPick = { count: number; price: number }

// Đơn bán theo set: số hũ từng vị, tổng tiền (Σ số set × giá 1 set), tổng số set
export function saleFromSets(kinds: SetKind[], picks: Record<string, SetPick>) {
  const jars = new Map<string, number>()
  let total = 0
  let sets = 0
  for (const kind of kinds) {
    const pick = picks[kind.key]
    if (!pick || pick.count <= 0) continue
    sets += pick.count
    total += pick.count * pick.price
    for (const [productId, n] of Object.entries(kind.mix)) {
      if (n > 0) jars.set(productId, (jars.get(productId) ?? 0) + n * pick.count)
    }
  }
  return { jars, total, sets }
}
