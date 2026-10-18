// Tính biểu thức số đơn giản gõ trong ô tiền: + − × ÷, ngoặc, hậu tố k (nghìn) / tr (triệu).
// "x" / "×" / "*" là nhân, "÷" / ":" / "/" là chia. Dấu chấm dạng 50.000 là phân cách nghìn.
// Không dùng eval; biểu thức sai trả về null.

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string }

function tokenize(input: string): Token[] | null {
  const text = input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[x×]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/−/g, '-')
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    // Số: 50.000 (phân cách nghìn) | 1.5 / 1,5 (thập phân) | 12 ; hậu tố k / tr
    const m = rest.match(/^(\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?)(k|tr)?/)
    if (m) {
      const raw = /^\d{1,3}(\.\d{3})+$/.test(m[1]) ? m[1].replace(/\./g, '') : m[1].replace(',', '.')
      const scale = m[2] === 'k' ? 1e3 : m[2] === 'tr' ? 1e6 : 1
      tokens.push({ kind: 'num', value: Number(raw) * scale })
      i += m[0].length
      continue
    }
    if ('+-*/()'.includes(text[i])) {
      tokens.push({ kind: 'op', value: text[i] })
      i++
      continue
    }
    return null
  }
  return tokens
}

// Đệ quy xuống: expr = term (± term)* ; term = factor (×÷ factor)* ; factor = số | (expr) | −factor
export function evalExpression(input: string): number | null {
  const tokens = tokenize(input)
  if (!tokens || tokens.length === 0) return null
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (v: string) => peek()?.kind === 'op' && peek()!.value === v

  const factor = (): number | null => {
    const tok = peek()
    if (!tok) return null
    if (tok.kind === 'num') {
      pos++
      return tok.value
    }
    if (isOp('-')) {
      pos++
      const v = factor()
      return v === null ? null : -v
    }
    if (isOp('(')) {
      pos++
      const v = expr()
      if (v === null || !isOp(')')) return null
      pos++
      return v
    }
    return null
  }
  const term = (): number | null => {
    let v = factor()
    while (v !== null && (isOp('*') || isOp('/'))) {
      const op = peek()!.value
      pos++
      const r = factor()
      if (r === null) return null
      if (op === '/' && r === 0) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const expr = (): number | null => {
    let v = term()
    while (v !== null && (isOp('+') || isOp('-'))) {
      const op = peek()!.value
      pos++
      const r = term()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  const value = expr()
  if (value === null || pos !== tokens.length || !Number.isFinite(value)) return null
  // Làm tròn 2 chữ số để tránh lỗi số thực (0.1 + 0.2)
  return Math.round(value * 100) / 100
}

// Ô có phép tính (không chỉ một con số) thì mới cần hiện kết quả
export const isExpression = (input: string) => /[-+*/x×÷:()]|\d\s*(k|tr)\b/i.test(input.trim().replace(/^-/, ''))
