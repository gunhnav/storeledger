// Trợ lý AI giải đáp nghiệp vụ (Web Nhập Liệu)
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

const SYSTEM_INSTRUCTION = `
Bạn là Trợ lý (quản lý bán hàng F&B / bán lẻ, hai cửa hàng: Hogi Food và Bún đậu).
Nghiệp vụ cốt lõi:
1. Nhập hàng & giá vốn (FIFO): nhập theo đợt, mỗi món một lô. Khi bán trừ lô cũ nhất trước. Lãi gộp = doanh thu thuần - giá vốn FIFO.
2. Kho: Hogi có bước Phân phối (nhà -> quán, hoặc -> công ty). Bún đậu không có Phân phối, nhập xong hàng vào thẳng quán.
3. Kênh bán: Hogi có Quán và Công ty; Bún đậu có Quán và Đối tác (giá đối tác, hoa hồng đối tác).
4. Bán set cho công ty (Hogi): set 4 hoặc 6 hũ, nhiều vị. Mỗi nhóm set có số set đã phân phối (set_count) và số đã bán (sold_count); trang Bán hàng chỉ hiện set còn lại, bán hết thì ẩn.
5. Chi phí: nhóm theo cửa hàng. Bún đậu: nhập kho tự ghi vào Chi phí (nhóm Đồ uống hoặc Nguyên liệu); các khoản này không tính lại vào Lãi lỗ và Điểm hoà vốn vì giá vốn đã tính. Lãi ròng = lãi gộp - chi phí.
Quy tắc:
- Trả lời ngắn gọn, gạch đầu dòng, đúng trọng tâm; không biết thì nói không biết, đừng bịa số liệu.
- Tuyệt đối không tiết lộ mật khẩu, IP, connection string, token hay bí mật hệ thống.
`;

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

async function callModel(apiKey: string, model: string, question: string, timeoutMs: number, outer: AbortSignal): Promise<{ text?: string; failure?: Failure }> {
  const started = Date.now();
  const send = (withThinking: boolean) =>
    fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700,
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
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
      console.log(`[chat-assistant] ${model} ok ${Date.now() - started}ms`);
      if (text) return { text };
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
    msg = "Trợ lý chưa dùng được: khoá GEMINI_API_KEY không hợp lệ hoặc chưa được cấp quyền. Nhờ admin kiểm tra.";
  } else if (last?.status === "timeout") {
    msg = "Trợ lý phản hồi quá chậm. Bạn thử gửi lại sau ít giây.";
  } else {
    msg = "Máy chủ AI đang quá tải. Bạn thử gửi lại sau ít giây.";
  }
  return detail ? `${msg}\n(Chi tiết: ${detail})` : msg;
}

// Chạy các model theo kiểu "hedge": model đầu chạy ngay; sau HEDGE_MS chưa có kết quả (hoặc nó vừa lỗi)
// thì chạy thêm model kế tiếp song song. Có câu trả lời đầu tiên là dùng và huỷ các lượt còn lại.
async function askModels(apiKey: string, question: string, failures: Failure[], elapsed: () => number): Promise<{ text: string; model: string } | null> {
  const queue = [...PREFERRED_MODELS];
  const discovery = discoverModels(apiKey).then((names) => {
    for (const m of names) if (!queue.includes(m)) queue.push(m);
  });
  const controllers: AbortController[] = [];
  return await new Promise((resolve) => {
    let next = 0;
    let inflight = 0;
    let finished = false;
    let timer: number | undefined;
    const finish = (value: { text: string; model: string } | null) => {
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
      const { text, failure } = await callModel(apiKey, model, question, Math.min(ATTEMPT_TIMEOUT_MS, left), ac.signal);
      inflight--;
      if (finished) return;
      if (text) return finish({ text, model });
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
        return reply({ answer: "Bạn cần đăng nhập vào Sổ Xanh để sử dụng trợ lý AI.", isError: true, durationMs: elapsed() });
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

      const safeQuestion = sanitizeText(question);
      const failures: Failure[] = [];
      const won = await askModels(apiKey, safeQuestion, failures, elapsed);
      if (won) return reply({ answer: sanitizeText(won.text), model: won.model, durationMs: elapsed() });

      return reply({ answer: friendlyError(failures), isError: true, durationMs: elapsed() });
    } catch (globalErr) {
      console.error(`[chat-assistant] ${(globalErr as Error).message}`);
      return reply({ answer: "Trợ lý gặp lỗi hệ thống. Bạn thử lại sau.", isError: true, durationMs: elapsed() });
    }
  },
};
