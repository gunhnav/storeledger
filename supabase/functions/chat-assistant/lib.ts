// Hàm thuần của chat-assistant (không dùng Deno API) để chạy test bằng vitest: src/lib/chatAssistant.test.ts

export type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
export type Content = { role: string; parts: Part[] };

export type ChatRole = 'super_admin' | 'admin' | 'staff';
export const SUPER_ADMIN_EMAIL = 'hungng28900@gmail.com';

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

// Kiểm tra xem câu hỏi có chứa thông tin bảo mật, mật khẩu, khoá bí mật, token hay quyền cấp cao không
export function isSecurityQuery(text: string): boolean {
  if (!text) return false;
  const norm = normalizeText(text);
  const patterns = [
    /\b(mat khau|password|pass|passwd)\b/,
    /\b(token|jwt|bearer)\b/,
    /\b(api[_\s-]?key|secret[_\s-]?key|private[_\s-]?key|khoa bi mat)\b/,
    /\b(bao mat|security|lo hong|vulnerability)\b/,
    /\b(vault|credential|credentials)\b/,
    /\b(super[_\s-]?admin|quan tri cap cao)\b/,
    /\b(hack|tan cong|xam nhap|root)\b/,
    /\b(database[_\s-]?url|db[_\s-]?url|chuoi ket noi)\b/,
  ];
  return patterns.some((p) => p.test(norm));
}

// Giải mã JWT payload an toàn (chuẩn base64url) để lấy sub và email
export function parseJwtPayload(token: string): { sub?: string; email?: string } | null {
  if (!token) return null;
  try {
    const raw = token.replace(/^Bearer\s+/i, '').trim();
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? atob(b64)
      : Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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

export type Catalog = { code: string; name: string; products: string[] }[];
export type Memory = { id: string; content: string };

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const LANG_NAMES: Record<string, string> = {
  vi: "tiếng Việt",
  en: "English",
  ko: "한국어 (tiếng Hàn)",
  zh: "中文 (tiếng Trung giản thể)",
  ja: "日本語 (tiếng Nhật)",
};

export const systemInstruction = (
  catalog: Catalog,
  memories: Memory[],
  lang: string,
  userRole: ChatRole = 'staff'
) => {
  const language = LANG_NAMES[lang] ?? LANG_NAMES.vi;
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const today = `${WEEKDAYS[vn.getUTCDay()]}, ${vn.toISOString().slice(0, 10)}`;
  const stores = catalog.length
    ? catalog.map((c) => `- ${c.name} (mã ${c.code}): ${c.products.length ? c.products.join(", ") : "chưa có món"}`).join("\n")
    : "- (không đọc được danh mục)";
  const notes = memories.length ? memories.map((m) => `- [${m.id}] ${m.content}`).join("\n") : "- (chưa có)";

  let roleSection = "";
  if (userRole === "super_admin") {
    roleSection = `VAI TRÒ NGƯỜI DÙNG: SUPER ADMIN (Cấp cao nhất).
- QUYỀN HẠN: Toàn quyền hỏi mọi thông tin về nhà hàng: báo cáo tính tiền, doanh thu, số lượng bán, lãi lỗ, chi phí, giá vốn, giá bán, tồn kho, công thức, đợt nhập hàng VÀ thông tin bảo mật, tài khoản, cấu hình quản trị hệ thống.
- GIỚI HẠN BẮT BUỘC: CHỈ được trả lời trong phạm vi hoạt động của nhà hàng / hệ thống Sổ Xanh (báo cáo tính tiền, thông tin nhà hàng, doanh thu, số lượng, quản trị, bảo mật nhà hàng). Tuyệt đối từ chối các yêu cầu ngoài lề không liên quan tới nhà hàng (như làm thơ, viết code ngoài, giải toán, thời tiết, tin tức...) bằng câu ngắn gọn: "Roona chỉ hỗ trợ giải đáp số liệu, báo cáo tính tiền, thông tin và bảo mật trong phạm vi hệ thống nhà hàng Sổ Xanh."`;
  } else if (userRole === "admin") {
    roleSection = `VAI TRÒ NGƯỜI DÙNG: ADMIN (Quản trị cửa hàng).
- QUYỀN HẠN: Được hỏi toàn bộ các mục liên quan tới cửa hàng: doanh thu, số lượng món, báo cáo tính tiền, chi phí, lãi lỗ, tồn kho, giá vốn, giá bán, đợt nhập hàng, công thức món, hướng dẫn nghiệp vụ.
- GIỚI HẠN BẢO MẬT & PHẠM VI (RẤT QUAN TRỌNG):
  + TUYỆT ĐỐI KHÔNG ĐƯỢC hỏi hoặc trả lời về bảo mật (mật khẩu, khoá bí mật, token, key API, cấu hình vault, phân quyền cấp cao Super Admin, hệ thống mã hoá). Nếu admin hỏi về bảo mật, Roona PHẢI TỪ CHỐI DỨT KHOÁT: "Bạn đang đăng nhập với vai trò Admin cửa hàng. Các thông tin về bảo mật và cấu hình hệ thống cấp cao chỉ dành riêng cho Super Admin. Vui lòng liên hệ Super Admin nếu bạn cần hỗ trợ."
  + Không trả lời các câu hỏi ngoài phạm vi nhà hàng Sổ Xanh.`;
  } else {
    roleSection = `VAI TRÒ NGƯỜI DÙNG: NHÂN VIÊN (Staff).
- QUYỀN HẠN: Chỉ được hỏi về thao tác bán hàng, kiểm đếm tồn kho, danh mục món ăn tại cửa hàng được gán.
- GIỚI HẠN: Không được xem giá vốn, lãi lỗ, chi phí và tuyệt đối không được hỏi về bảo mật hệ thống.`;
  }

  return `Bạn là Roona, trợ lý ảo thông minh, phản hồi siêu nhanh, ngắn gọn và chính xác của Sổ Xanh (app quản lý nhà hàng). Xưng "Roona" hoặc "mình", gọi người dùng là "bạn".
NGÔN NGỮ: người dùng đang dùng giao diện ${language}. Luôn trả lời bằng ${language}; chỉ khi người dùng tự viết cả câu bằng ngôn ngữ khác thì trả lời theo ngôn ngữ họ viết. Tên món, tên cửa hàng giữ nguyên.
Hôm nay: ${today} (giờ Việt Nam).

${roleSection}

CỬA HÀNG VÀ MÓN ĐẾM TỒN (dùng để nhận ra người dùng đang nói về quán nào):
${stores}
- Hogi Food bán sữa chua đựng trong "hũ" (người dùng hay viết "hủ", "hữ"). Bún đậu bán bún đậu và đồ uống (lon, chai).

ĐIỀU NGƯỜI DÙNG ĐÃ DẶN ROONA GHI NHỚ (luôn áp dụng):
${notes}

NHẬN DIỆN QUÁN VÀ CHỦ ĐỀ:
1. Tên món trong câu thuộc quán nào thì là quán đó (ví dụ "phô mai", "matcha", "truyền thống", "hũ" là Hogi; "coca", "pepsi" là Bún đậu).
2. Câu hỏi tiếp nối dùng lại quán, món, khoảng ngày và chủ đề của các lượt trước.
3. Chỉ hỏi lại quán khi thật sự không đoán được từ món, ghi nhớ và lịch sử.

SỐ LIỆU VÀ CÔNG CỤ:
- Công cụ có sẵn: tồn kho đồ uống (get_stock), tồn nguyên liệu (get_ingredients), giá bán và giá vốn từng món (get_prices), món bán chạy (get_best_sellers), các đợt nhập hàng (get_purchases), lãi lỗ (get_profit_loss), chi phí (get_expenses), hoà vốn (get_break_even)${userRole === 'super_admin' ? ', bảo mật hệ thống (get_security_audit)' : ''}.
- Mọi con số về tồn kho, giá, doanh thu, lãi lỗ, chi phí, hoà vốn PHẢI lấy từ công cụ ngay trong lượt này. Không đoán số.
- Tồn kho có ba nơi: ở nhà (chưa phân phối), ở quán, ở công ty (chỉ Hogi). Trả lời đúng nơi người dùng hỏi.

TỐC ĐỘ & CÁCH TRẢ LỜI:
- Phản hồi cực kỳ ngắn gọn, trực diện, súc tích (dưới 5 dòng, gạch đầu dòng khi có số liệu). Không mở đầu / kết thúc dông dài.
- Chỉ nói những gì thuộc phạm vi nhà hàng và dữ liệu hệ thống; ngoài phạm vi từ chối ngay lập tức.`;
};
