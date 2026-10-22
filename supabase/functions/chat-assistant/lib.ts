// Hàm thuần của chat-assistant (không dùng Deno API) để chạy test bằng vitest: src/lib/chatAssistant.test.ts

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
type Content = { role: string; parts: Part[] };

export function sanitizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "[REDACTED_IP]")
    .replace(/(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi, "[REDACTED_DB_URL]")
    .replace(/https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?/gi, "[REDACTED_URL]")
    .replace(/(password|secret|token|api_key|jwt|credential)\s*[:=]\s*['"][^'"]+['"]/gi, '$1: "[REDACTED]"')
    .replace(/[a-zA-Z0-9.-]+\.(internal|local|com\.vn)/gi, "[REDACTED_DOMAIN]");
}

export const normalizeText = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d");

// Chọn cửa hàng theo mã hoặc tên (không dấu, không phân biệt hoa thường)
export function pickStore<T extends { code: string; name: string }>(rows: T[], store: unknown): T | undefined {
  const key = normalizeText(String(store ?? ""));
  if (!key) return undefined;
  return rows.find((r) => normalizeText(r.code) === key) ?? rows.find((r) => normalizeText(r.name).includes(key) || key.includes(normalizeText(r.code)));
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validRange(from: unknown, to: unknown): { from: string; to: string } | null {
  const f = String(from ?? "");
  const t = String(to ?? "");
  return ISO_DATE.test(f) && ISO_DATE.test(t) && f <= t ? { from: f, to: t } : null;
}

export type HistoryItem = { role?: string; text?: string };
export const MAX_HISTORY = 16;

// Lịch sử từ client -> contents của Gemini (user / model xen kẽ, gộp lượt liền nhau cùng vai)
export function historyContents(history: unknown): Content[] {
  if (!Array.isArray(history)) return [];
  const out: Content[] = [];
  for (const h of (history as HistoryItem[]).slice(-MAX_HISTORY)) {
    const text = String(h?.text ?? "").trim().slice(0, 1500);
    if (!text) continue;
    const role = h?.role === "assistant" ? "model" : "user";
    const last = out.at(-1);
    if (last?.role === role) last.parts.push({ text: sanitizeText(text) });
    else out.push({ role, parts: [{ text: sanitizeText(text) }] });
  }
  while (out[0]?.role === "model") out.shift();
  return out;
}

