// Trợ lý ảo Roona giải đáp nghiệp vụ (Web Nhập Liệu)
// Gọi Gemini generateContent; model quá tải (503/429), hết hạn (404) hoặc quá chậm thì chuyển ngay
// sang model khác thay vì gọi lại đúng model đó. Chi tiết lỗi chỉ ghi log, người dùng thấy thông báo gọn.
import "@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API = "https://generativelanguage.googleapis.com/v1beta";
// Model ưu tiên; các model flash khác còn hoạt động được lấy từ ListModels làm dự phòng
const PREFERRED_MODELS = (Deno.env.get("GEMINI_MODELS") ?? "gemini-3.8-flash-lite,gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean);
const ATTEMPT_TIMEOUT_MS = 20000;
const HEDGE_MS = 3000;
const TOTAL_BUDGET_MS = 28000;
const MAX_QUESTION_CHARS = 2000;

function reply(body: unknown) {
  return Response.json(body, { status: 200, headers: CORS_HEADERS });
}

function sanitizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "[REDACTED_IP]")
    .replace(/(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi, "[REDACTED_DB_URL]")
    .replace(/https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?/gi, "[REDACTED_URL]")
    .replace(/(password|secret|token|api_key|jwt|credential)\s*[:=]\s*['"][^'"]+['"]/gi, '$1: "[REDACTED]"')
    .replace(/[a-zA-Z0-9.-]+\.(internal|local|com\.vn)/gi, "[REDACTED_DOMAIN]");
}

type Catalog = { code: string; name: string; products: string[] }[];
type Memory = { id: string; content: string };

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

const systemInstruction = (catalog: Catalog, memories: Memory[]) => {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const today = `${WEEKDAYS[vn.getUTCDay()]}, ${vn.toISOString().slice(0, 10)}`;
  const stores = catalog.length
    ? catalog.map((c) => `- ${c.name} (mã ${c.code}): ${c.products.length ? c.products.join(", ") : "chưa có món"}`).join("\n")
    : "- (không đọc được danh mục)";
  const notes = memories.length ? memories.map((m) => `- [${m.id}] ${m.content}`).join("\n") : "- (chưa có)";
  return `Bạn là Roona, trợ lý ảo vui vẻ, thân thiện của Sổ Xanh (app quản lý bán hàng). Xưng "Roona" hoặc "mình", gọi người dùng là "bạn".
Hôm nay: ${today} (giờ Việt Nam). Ngày không kèm năm thì hiểu là năm nay; "hôm qua", "tuần này", "tháng này" tự quy ra ngày cụ thể.

CỬA HÀNG VÀ MÓN ĐẾM TỒN (dùng để nhận ra người dùng đang nói về quán nào):
${stores}
- Hogi Food bán sữa chua đựng trong "hũ" (người dùng hay viết "hủ", "hữ"). Bún đậu bán bún đậu và đồ uống (lon, chai).

ĐIỀU NGƯỜI DÙNG ĐÃ DẶN ROONA GHI NHỚ (luôn áp dụng):
${notes}

NHẬN DIỆN QUÁN VÀ CHỦ ĐỀ:
1. Tên món trong câu thuộc quán nào thì là quán đó (ví dụ "phô mai", "matcha", "truyền thống", "hũ" là Hogi; "coca", "pepsi" là Bún đậu).
2. Câu hỏi tiếp nối (ví dụ "còn ở nhà?", "bạn có chắc không", "hogi", "thế còn tháng trước?") dùng lại quán, món, khoảng ngày và chủ đề của các lượt trước trong cuộc trò chuyện. Người dùng chỉ trả lời tên quán thì làm tiếp yêu cầu đang dở với quán đó, không chào lại.
3. Chỉ hỏi lại quán khi thật sự không đoán được từ món, ghi nhớ và lịch sử.

SỐ LIỆU:
- Mọi con số về tồn kho, doanh thu, lãi lỗ, chi phí, hoà vốn PHẢI lấy từ công cụ ngay trong lượt này. Không nhớ số cũ, không đoán.
- Người dùng nghi ngờ ("chắc không", "sao tôi thấy khác") thì gọi lại công cụ và trả lời theo số mới; nếu số khác người dùng thấy thì nói rõ số hệ thống, đừng khẳng định "chắc 100%".
- Tồn kho có ba nơi: ở nhà (chưa phân phối), ở quán, ở công ty (chỉ Hogi). Trả lời đúng nơi người dùng hỏi.

NGHIỆP VỤ (chỉ mô tả những gì có thật dưới đây, không bịa thêm trường hay màn hình):
- Menu: Bán hàng; Kho hàng (Nhập hàng, Phân phối [chỉ Hogi]: Ra quán / Cho công ty, Tồn kho); Báo cáo (Tổng quan: hoà vốn, lãi lỗ, chi phí theo kỳ; Nhật ký ngày; Theo đợt nhập; Bán chạy); Quản lý (Sản phẩm, Chi phí). Không có "nhà cung cấp".
- Nhập hàng: chọn ngày, món, số lượng, giá nhập (để trống = giá vốn đang áp dụng). Hogi: hàng vào "ở nhà", rồi Phân phối ra quán hoặc cho công ty. Bún đậu: hàng vào thẳng quán và tiền nhập tự ghi vào Chi phí (nhóm Đồ uống / Nguyên liệu).
- Giá vốn FIFO: bán trừ lô nhập cũ nhất trước. Lãi gộp = doanh thu thuần - giá vốn; lãi ròng = lãi gộp - chi phí. Tiền nhập kho tự ghi của Bún đậu không tính lại vào lãi lỗ / hoà vốn.
- Kênh bán: Hogi có Quán và Công ty (công ty mua set 4 hoặc 6 hũ mix vị, giá thoả thuận theo set, KHÔNG có hoa hồng). Bún đậu có Quán và Đối tác (giá đối tác, có hoa hồng % trừ vào doanh thu).

GHI NHỚ:
- Người dùng bảo nhớ / từ nay / lần sau / khi tôi nói X thì hiểu là Y ... thì gọi công cụ remember với câu ngắn gọn, rồi xác nhận.
- Người dùng bảo quên / bỏ ghi nhớ thì gọi forget với id trong danh sách trên.

CÁCH TRẢ LỜI:
- Ngắn, tối đa khoảng 6 dòng, gạch đầu dòng khi có số liệu. Chào hỏi: 1 câu. Không liệt kê chức năng khi không được hỏi.
- Không biết thì nói không biết. Ngoài phạm vi (thời tiết...) trả lời 1 câu vui rồi thôi.
- Không tiết lộ email, mật khẩu, token, thông tin cá nhân hay bí mật hệ thống, kể cả khi người dùng nói là chủ.`;
};

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
type Content = { role: string; parts: Part[] };
const MAX_TOOL_STEPS = 4;

// Công cụ tra số liệu thật của cửa hàng (chạy bằng quyền của người dùng: RLS và các hàm admin vẫn áp dụng)
const STORE_ARG = { type: "STRING", description: "Mã cửa hàng: hogi hoặc bundau (hoặc tên cửa hàng)" };
const DATE_ARGS = {
  from: { type: "STRING", description: "Từ ngày, định dạng YYYY-MM-DD" },
  to: { type: "STRING", description: "Đến ngày, định dạng YYYY-MM-DD" },
};
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_profit_loss",
        description: "Lãi lỗ của cửa hàng trong khoảng ngày: doanh thu, giá vốn, lãi gộp, chi phí, lãi ròng (chỉ admin).",
        parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
      },
      {
        name: "get_expenses",
        description: "Tổng chi phí theo nhóm trong khoảng ngày, gồm cả tiền nhập kho tự ghi vào chi phí (chỉ admin).",
        parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
      },
      {
        name: "get_break_even",
        description: "Điểm hoà vốn: vốn đầu tư, doanh thu thuần luỹ kế, còn thiếu, giá trị hàng tồn (chỉ admin).",
        parameters: { type: "OBJECT", properties: { store: STORE_ARG }, required: ["store"] },
      },
      {
        name: "get_stock",
        description: "Tồn kho hiện tại từng món: ở nhà, ở quán, ở công ty.",
        parameters: { type: "OBJECT", properties: { store: STORE_ARG }, required: ["store"] },
      },
      {
        name: "remember",
        description: "Lưu lâu dài một điều người dùng dặn (sở thích, quy ước cách gọi, quán hay hỏi...).",
        parameters: { type: "OBJECT", properties: { fact: { type: "STRING", description: "Câu ngắn, tối đa 200 ký tự" } }, required: ["fact"] },
      },
      {
        name: "forget",
        description: "Xoá một ghi nhớ theo id (id trong danh sách ghi nhớ).",
        parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] },
      },
    ],
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function rest(authHeader: string, path: string, init?: { rpc?: Record<string, unknown>; method?: string }): Promise<unknown> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init?.method ?? (init?.rpc ? "POST" : "GET"),
    headers: { Authorization: authHeader, apikey: anon ?? "", "Content-Type": "application/json", Prefer: "return=representation" },
    body: init?.rpc ? JSON.stringify(init.rpc) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(res.status === 403 || err?.code === "42501" ? "Tài khoản này không có quyền xem số liệu đó (cần admin)." : String(err?.message ?? res.status));
  }
  return await res.json();
}

async function resolveStore(authHeader: string, store: unknown): Promise<{ id: string; name: string }> {
  const rows = (await rest(authHeader, "stores?select=id,code,name")) as { id: string; code: string; name: string }[];
  const key = String(store ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d");
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d");
  const hit = rows.find((r) => norm(r.code) === key) ?? rows.find((r) => norm(r.name).includes(key) || key.includes(norm(r.code)));
  if (!hit) throw new Error(`Không tìm thấy cửa hàng "${store}". Cửa hàng bạn xem được: ${rows.map((r) => r.code).join(", ")}`);
  return hit;
}

async function runTool(authHeader: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    if (name === "remember") {
      const fact = String(args.fact ?? "").trim().slice(0, 300);
      if (!fact) throw new Error("Ghi nhớ trống");
      const rows = (await rest(authHeader, "assistant_memories", { rpc: { content: fact } })) as Memory[];
      return { saved: true, id: rows?.[0]?.id, fact };
    }
    if (name === "forget") {
      const id = String(args.id ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("id không hợp lệ");
      const rows = (await rest(authHeader, `assistant_memories?id=eq.${id}`, { method: "DELETE" })) as Memory[];
      return { deleted: rows.length > 0 };
    }
    const store = await resolveStore(authHeader, args.store);
    if (name === "get_stock") {
      return { store: store.name, rows: await rest(authHeader, "rpc/get_stock_status", { rpc: { p_store_id: store.id } }) };
    }
    if (name === "get_break_even") {
      return { store: store.name, data: await rest(authHeader, "rpc/get_break_even", { rpc: { p_store_id: store.id } }) };
    }
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new Error("Khoảng ngày không hợp lệ (cần YYYY-MM-DD, từ <= đến).");
    if (name === "get_profit_loss") {
      const rows = (await rest(authHeader, "rpc/get_pnl", { rpc: { p_store_id: store.id, p_period: "day", p_from: from, p_to: to } })) as Record<string, number>[];
      const keys = ["gross_revenue", "commission", "net_revenue", "cogs", "gross_profit", "expenses", "net_profit"];
      const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)]));
      return {
        store: store.name, from, to, totals,
        note: "expenses ở đây KHÔNG gồm tiền nhập kho tự ghi (giá vốn đã tính). Đơn vị VND.",
        daily: rows.length <= 40 ? rows : undefined,
      };
    }
    if (name === "get_expenses") {
      const rows = (await rest(authHeader, `expenses?select=category,amount,expense_date&store_id=eq.${store.id}&expense_date=gte.${from}&expense_date=lte.${to}&limit=5000`)) as { category: string; amount: number }[];
      const byCategory: Record<string, number> = {};
      for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + Number(r.amount);
      return { store: store.name, from, to, total: rows.reduce((s, r) => s + Number(r.amount), 0), byCategory, count: rows.length };
    }
    return { error: `Công cụ không tồn tại: ${name}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// Danh mục quán + món đếm tồn mà người dùng xem được, và ghi nhớ của họ (đọc song song với xác thực)
async function loadCatalog(authHeader: string): Promise<Catalog> {
  try {
    const rows = (await rest(authHeader, "stores?select=code,name,products(name,tracks_stock,is_active)")) as {
      code: string; name: string; products: { name: string; tracks_stock: boolean; is_active: boolean }[];
    }[];
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      products: r.products.filter((p) => p.tracks_stock && p.is_active).map((p) => p.name).sort(),
    }));
  } catch (err) {
    console.error(`[chat-assistant] catalog: ${(err as Error).message}`);
    return [];
  }
}

async function loadMemories(authHeader: string): Promise<Memory[]> {
  try {
    return (await rest(authHeader, "assistant_memories?select=id,content&order=created_at&limit=30")) as Memory[];
  } catch (err) {
    console.error(`[chat-assistant] memories: ${(err as Error).message}`);
    return [];
  }
}

type HistoryItem = { role?: string; text?: string };
const MAX_HISTORY = 16;

// Lịch sử từ client -> contents của Gemini (user / model xen kẽ, gộp lượt liền nhau cùng vai)
function historyContents(history: unknown): Content[] {
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

type Failure = { model: string; status: number | "timeout" | "error"; retryable: boolean; ms?: number };

// Xác thực người dùng bằng token thật (hàm tắt verify_jwt nên tự kiểm tra, tránh bị gọi tốn phí)
async function isSignedIn(authHeader: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return true;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: anon } });
    return res.ok;
  } catch {
    return false;
  }
}

// Danh sách model flash còn dùng được, lưu tạm 10 phút
let modelCache: { at: number; names: string[] } | null = null;
async function discoverModels(apiKey: string): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.names;
  try {
    const res = await fetch(`${API}/models?pageSize=200`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = (data.models ?? [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        /flash/.test(m.name) &&
        !/(image|tts|audio|live|embedding|robotics|computer|thinking|exp)/.test(m.name))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      // Bản không "lite" trước, mới nhất (tên dài hơn / lớn hơn) trước
      .sort((a: string, b: string) => Number(/lite/.test(a)) - Number(/lite/.test(b)) || b.localeCompare(a));
    modelCache = { at: Date.now(), names };
    return names;
  } catch {
    return [];
  }
}

// Chat nghiệp vụ chỉ cần model flash đọc số liệu rồi trả lời, không cần "suy nghĩ" (rất chậm).
// Thử tắt suy nghĩ theo thứ tự: thinkingLevel "minimal" (Gemini 3) -> thinkingBudget 0 (Gemini 2.5) -> không gửi tham số.
// API từ chối (400) thì lùi sang cách kế tiếp và nhớ lại cho các lần gọi sau.
const THINKING_MODES: (Record<string, unknown> | null)[] = [{ thinkingLevel: "minimal" }, { thinkingBudget: 0 }, null];
let thinkingMode = 0;
// Model đã bị gỡ / không tồn tại (404): bỏ qua ở các lần sau trong cùng instance
const deadModels = new Set<string>();

async function callModel(apiKey: string, model: string, system: string, contents: Content[], timeoutMs: number, outer: AbortSignal): Promise<{ content?: Content; failure?: Failure }> {
  const started = Date.now();
  const send = (mode: number) =>
    fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: TOOLS,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
          ...(THINKING_MODES[mode] ? { thinkingConfig: THINKING_MODES[mode] } : {}),
        },
      }),
    });
  try {
    let res = await send(thinkingMode);
    while (res.status === 400 && thinkingMode < THINKING_MODES.length - 1) {
      console.error(`[chat-assistant] ${model} từ chối thinkingConfig #${thinkingMode}: ${(await res.text()).slice(0, 200)}`);
      thinkingMode++;
      res = await send(thinkingMode);
    }
    if (res.ok) {
      const data = await res.json();
      const content: Content | undefined = data?.candidates?.[0]?.content;
      console.log(`[chat-assistant] ${model} ok ${Date.now() - started}ms finish=${data?.candidates?.[0]?.finishReason}`);
      if (content?.parts?.some((p) => p.text || p.functionCall)) return { content };
      return { failure: { model, status: "error", retryable: true, ms: Date.now() - started } };
    }
    console.error(`[chat-assistant] ${model} -> ${res.status} sau ${Date.now() - started}ms: ${(await res.text()).slice(0, 300)}`);
    // 503/429/5xx: model đang quá tải; 404: model đã gỡ; 400/403: lỗi cấu hình / key (không thử lại được)
    if (res.status === 404) deadModels.add(model);
    const retryable = res.status === 503 || res.status === 429 || res.status === 404 || res.status >= 500;
    return { failure: { model, status: res.status, retryable, ms: Date.now() - started } };
  } catch (err) {
    const name = (err as Error).name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    console.error(`[chat-assistant] ${model} ${timedOut ? "timeout" : "exception"} sau ${Date.now() - started}ms: ${(err as Error).message}`);
    return { failure: { model, status: timedOut ? "timeout" : "error", retryable: true, ms: Date.now() - started } };
  }
}

function friendlyError(failures: Failure[]): string {
  const last = failures.at(-1);
  const detail = failures.map((f) => `${f.model}: ${f.status}${f.ms ? ` ${Math.round(f.ms / 1000)}s` : ""}`).join("; ");
  let msg: string;
  if (failures.some((f) => f.status === 400 || f.status === 403)) {
    msg = "Roona chưa kết nối được: khoá GEMINI_API_KEY không hợp lệ hoặc chưa được cấp quyền. Nhờ admin kiểm tra.";
  } else if (last?.status === "timeout") {
    msg = "Roona suy nghĩ hơi lâu xíu. Bạn thử gửi lại sau vài giây nha!";
  } else {
    msg = "Máy chủ AI đang quá tải. Bạn thử gửi lại sau ít giây để Roona trả lời nhé!";
  }
  return detail ? `${msg}\n(Chi tiết: ${detail})` : msg;
}

// Chạy các model theo kiểu "hedge": model đầu chạy ngay; sau HEDGE_MS chưa có kết quả (hoặc nó vừa lỗi)
// thì chạy thêm model kế tiếp song song. Có câu trả lời đầu tiên là dùng và huỷ các lượt còn lại.
async function askModels(apiKey: string, system: string, contents: Content[], failures: Failure[], elapsed: () => number): Promise<{ content: Content; model: string } | null> {
  const queue = PREFERRED_MODELS.filter((m) => !deadModels.has(m));
  const discovery = discoverModels(apiKey).then((names) => {
    for (const m of names) if (!queue.includes(m) && !deadModels.has(m)) queue.push(m);
  });
  const controllers: AbortController[] = [];
  return await new Promise<{ content: Content; model: string } | null>((resolve) => {
    let next = 0;
    let inflight = 0;
    let finished = false;
    let timer: number | undefined;
    const finish = (value: { content: Content; model: string } | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const c of controllers) c.abort();
      resolve(value);
    };
    const launch = async () => {
      if (finished) return;
      if (next >= queue.length) await discovery;
      const left = TOTAL_BUDGET_MS - elapsed();
      if (next >= queue.length || left < 2500) {
        if (inflight === 0) finish(null);
        return;
      }
      const model = queue[next++];
      inflight++;
      const ac = new AbortController();
      controllers.push(ac);
      timer = setTimeout(launch, HEDGE_MS);
      const { content, failure } = await callModel(apiKey, model, system, contents, Math.min(ATTEMPT_TIMEOUT_MS, left), ac.signal);
      inflight--;
      if (finished) return;
      if (content) return finish({ content, model });
      if (failure) failures.push(failure);
      if (failure && !failure.retryable) return finish(null);
      // Lượt này lỗi sớm: chạy model kế tiếp ngay, không chờ hết HEDGE_MS
      clearTimeout(timer);
      launch();
    };
    launch();
  });
}

export default {
  fetch: async (req: Request) => {
    const startTime = Date.now();
    const elapsed = () => Date.now() - startTime;
    try {
      if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
      if (req.method !== "POST") return reply({ answer: "Chỉ nhận POST", isError: true });

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return reply({ answer: "Bạn cần đăng nhập vào Sổ Xanh để trò chuyện cùng Roona nhé!", isError: true, durationMs: elapsed() });
      }
      // Xác thực và nạp ngữ cảnh chạy song song để đỡ chậm
      const [signedIn, catalog, memories] = await Promise.all([isSignedIn(authHeader), loadCatalog(authHeader), loadMemories(authHeader)]);
      if (!signedIn) {
        return reply({ answer: "Bạn cần đăng nhập vào Sổ Xanh để trò chuyện cùng Roona nhé!", isError: true, durationMs: elapsed() });
      }

      let body: { question?: string; history?: unknown };
      try {
        body = await req.json();
      } catch {
        return reply({ answer: "Dữ liệu gửi lên không hợp lệ", isError: true, durationMs: elapsed() });
      }
      const question = (body.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
      if (!question) return reply({ answer: "Vui lòng nhập câu hỏi", isError: true, durationMs: elapsed() });

      const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
      if (!apiKey) {
        return reply({
          answer: "Chưa cấu hình GEMINI_API_KEY trên Supabase Secrets. Chạy lệnh: `npx supabase secrets set GEMINI_API_KEY=your_key` để kích hoạt.",
          notConfigured: true,
          durationMs: elapsed(),
        });
      }

      const failures: Failure[] = [];
      const system = systemInstruction(catalog, memories);
      const contents: Content[] = historyContents(body.history);
      if (contents.at(-1)?.role === "user") contents.push({ role: "model", parts: [{ text: "(đã ghi nhận)" }] });
      contents.push({ role: "user", parts: [{ text: sanitizeText(question) }] });
      // Tối đa vài vòng: model xin dữ liệu (functionCall) -> mình tra bằng quyền của chính người dùng -> trả lại cho model
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const won = await askModels(apiKey, system, contents, failures, elapsed);
        if (!won) break;
        const calls = won.content.parts.filter((p) => p.functionCall);
        if (calls.length === 0) {
          const text = won.content.parts.map((p) => p.text ?? "").join("").trim();
          return reply({ answer: sanitizeText(text), model: won.model, durationMs: elapsed() });
        }
        contents.push(won.content);
        const responses = await Promise.all(
          calls.map(async (c) => ({
            functionResponse: { name: c.functionCall!.name, response: await runTool(authHeader, c.functionCall!.name, c.functionCall!.args ?? {}) },
          })),
        );
        contents.push({ role: "user", parts: responses });
      }

      return reply({ answer: friendlyError(failures), isError: true, durationMs: elapsed() });
    } catch (globalErr) {
      console.error(`[chat-assistant] ${(globalErr as Error).message}`);
      return reply({ answer: "Trợ lý gặp lỗi hệ thống. Bạn thử lại sau.", isError: true, durationMs: elapsed() });
    }
  },
};
