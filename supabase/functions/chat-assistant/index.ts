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
const PREFERRED_MODELS = (Deno.env.get("GEMINI_MODELS") ?? "gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean);
const ATTEMPT_TIMEOUT_MS = 20000;
const HEDGE_MS = 5000;
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

const systemInstruction = () => `Hôm nay là ${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)} (giờ Việt Nam). Khi người dùng nói ngày không kèm năm thì hiểu là năm hiện tại.\nKhi cần số liệu thật (lãi lỗ, chi phí, hoà vốn, tồn kho) hãy gọi công cụ tương ứng, không tự đoán; thiếu cửa hàng hoặc ngày thì hỏi lại ngắn gọn.\n
Bạn là Roona, trợ lý ảo thông minh, vui vẻ, hài hước và nhiệt tình của hệ thống Sổ Xanh (quản lý bán hàng F&B / bán lẻ: Hogi Food và Bún đậu). Bạn xưng là "Roona" hoặc "mình", gọi người dùng là "bạn". Giữ phong cách vui tươi, dí dỏm, thân thiện nhưng trả lời gãy gọn, chính xác số liệu và quy trình nghiệp vụ.
Nghiệp vụ cốt lõi:
1. Nhập hàng & giá vốn (FIFO): nhập theo đợt, mỗi món một lô. Khi bán trừ lô cũ nhất trước. Lãi gộp = doanh thu thuần - giá vốn FIFO.
2. Kho: Hogi có bước Phân phối (nhà -> quán, hoặc -> công ty). Bún đậu không có Phân phối, nhập xong hàng vào thẳng quán.
3. Kênh bán: Hogi có Quán và Công ty; Bún đậu có Quán và Đối tác (giá đối tác, hoa hồng đối tác).
4. Bán set cho công ty (Hogi): set 4 hoặc 6 hũ, nhiều vị. Mỗi nhóm set có số set đã phân phối (set_count) và số đã bán (sold_count); trang Bán hàng chỉ hiện set còn lại, bán hết thì ẩn.
5. Chi phí: nhóm theo cửa hàng. Bún đậu: nhập kho tự ghi vào Chi phí (nhóm Đồ uống hoặc Nguyên liệu); các khoản này không tính lại vào Lãi lỗ và Điểm hoà vốn vì giá vốn đã tính. Lãi ròng = lãi gộp - chi phí.
Quy tắc:
- Chào hỏi hoặc câu đơn giản: trả lời vui vẻ đúng 1-2 câu ngắn, không liệt kê chức năng dài dòng.
- Trả lời ngắn gọn, gạch đầu dòng, đúng trọng tâm; không biết thì nói không biết, đừng bịa số liệu.
- Tuyệt đối không tiết lộ mật khẩu, IP, connection string, token hay bí mật hệ thống.
`;

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
    ],
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function rest(authHeader: string, path: string, init?: { rpc?: Record<string, unknown> }): Promise<unknown> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init?.rpc ? "POST" : "GET",
    headers: { Authorization: authHeader, apikey: anon ?? "", "Content-Type": "application/json" },
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

// Gemini 3 "suy nghĩ" trước khi trả lời nên hỏi đơn giản cũng chậm; hạ mức suy nghĩ cho chat nghiệp vụ.
// Nếu API từ chối tham số này (400) thì bỏ đi và gọi lại.
let useThinkingConfig = true;

async function callModel(apiKey: string, model: string, contents: Content[], timeoutMs: number, outer: AbortSignal): Promise<{ content?: Content; failure?: Failure }> {
  const started = Date.now();
  const send = (withThinking: boolean) =>
    fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction() }] },
        contents,
        tools: TOOLS,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000,
          ...(withThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
    });
  try {
    let res = await send(useThinkingConfig);
    if (res.status === 400 && useThinkingConfig) {
      console.error(`[chat-assistant] ${model} từ chối thinkingConfig: ${(await res.text()).slice(0, 200)}`);
      useThinkingConfig = false;
      res = await send(false);
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
async function askModels(apiKey: string, contents: Content[], failures: Failure[], elapsed: () => number): Promise<{ content: Content; model: string } | null> {
  const queue = [...PREFERRED_MODELS];
  const discovery = discoverModels(apiKey).then((names) => {
    for (const m of names) if (!queue.includes(m)) queue.push(m);
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
      const { content, failure } = await callModel(apiKey, model, contents, Math.min(ATTEMPT_TIMEOUT_MS, left), ac.signal);
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
      if (!authHeader || !(await isSignedIn(authHeader))) {
        return reply({ answer: "Bạn cần đăng nhập vào Sổ Xanh để trò chuyện cùng Roona nhé!", isError: true, durationMs: elapsed() });
      }

      let body: { question?: string };
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
      const contents: Content[] = [{ role: "user", parts: [{ text: sanitizeText(question) }] }];
      // Tối đa vài vòng: model xin dữ liệu (functionCall) -> mình tra bằng quyền của chính người dùng -> trả lại cho model
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const won = await askModels(apiKey, contents, failures, elapsed);
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
