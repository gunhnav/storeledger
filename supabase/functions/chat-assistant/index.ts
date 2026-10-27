// Trợ lý ảo Roona giải đáp nghiệp vụ (Web Nhập Liệu)
// Phân chia vai trò: Super Admin (toàn quyền + bảo mật trong phạm vi nhà hàng), Admin (quán, doanh thu, cấm bảo mật), Staff (bán hàng/kho cơ bản).
// Tối ưu tốc độ phản hồi cực nhanh (thinkingBudget: 0, caching, flash-lite models, early guard).
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  historyContents,
  isSecurityQuery,
  normalizeText,
  parseJwtPayload,
  pickStore,
  sanitizeText,
  SUPER_ADMIN_EMAIL,
  systemInstruction,
  validRange,
  type Catalog,
  type ChatRole,
  type Content,
  type Memory,
} from "./lib.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API = "https://generativelanguage.googleapis.com/v1beta";
// Model ưu tiên: flash-lite phản hồi nhanh nhất (sub-second), sau đó tới flash
const PREFERRED_MODELS = (
  Deno.env.get("GEMINI_MODELS") ??
  "gemini-2.5-flash-lite,gemini-3.8-flash-lite,gemini-2.5-flash,gemini-1.5-flash"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const ATTEMPT_TIMEOUT_MS = 18000;
const HEDGE_MS = 2500;
const TOTAL_BUDGET_MS = 25000;
const MAX_QUESTION_CHARS = 2000;

function reply(body: unknown) {
  return Response.json(body, { status: 200, headers: CORS_HEADERS });
}

const MAX_TOOL_STEPS = 4;

// Công cụ tra số liệu thật của cửa hàng (chạy bằng quyền của người dùng: RLS và các hàm admin vẫn áp dụng)
const STORE_ARG = { type: "STRING", description: "Mã cửa hàng: hogi hoặc bundau (hoặc tên cửa hàng)" };
const DATE_ARGS = {
  from: { type: "STRING", description: "Từ ngày, định dạng YYYY-MM-DD" },
  to: { type: "STRING", description: "Đến ngày, định dạng YYYY-MM-DD" },
};

const BASE_TOOLS = [
  {
    name: "get_profit_loss",
    description: "Lãi lỗ của cửa hàng trong khoảng ngày: doanh thu, giá vốn, lãi gộp, chi phí, lãi ròng (admin & super admin).",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
  },
  {
    name: "get_expenses",
    description: "Tổng chi phí theo nhóm trong khoảng ngày, gồm cả tiền nhập kho tự ghi vào chi phí (admin & super admin).",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
  },
  {
    name: "get_break_even",
    description: "Điểm hoà vốn: vốn đầu tư, doanh thu thuần luỹ kế, còn thiếu, giá trị hàng tồn (admin & super admin).",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG }, required: ["store"] },
  },
  {
    name: "get_stock",
    description: "Tồn kho hiện tại từng món: ở nhà, ở quán, ở công ty.",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG }, required: ["store"] },
  },
  {
    name: "get_prices",
    description: "Giá bán hiện hành (quán, đối tác) và giá vốn của từng món; có thể lọc theo tên món. Giá vốn chỉ admin/super admin xem được.",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG, product: { type: "STRING", description: "Tên món (tuỳ chọn, không dấu cũng được)" } }, required: ["store"] },
  },
  {
    name: "get_best_sellers",
    description: "Món bán chạy trong khoảng ngày: số lượng và doanh thu theo từng món.",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
  },
  {
    name: "get_purchases",
    description: "Các đợt nhập hàng trong khoảng ngày: ngày, món, số lượng, giá nhập (admin & super admin).",
    parameters: { type: "OBJECT", properties: { store: STORE_ARG, ...DATE_ARGS }, required: ["store", "from", "to"] },
  },
  {
    name: "get_ingredients",
    description: "Tồn kho nguyên liệu của quán (chả cốm, chả ốc, giò...): đã nhập, đã dùng theo doanh thu × công thức, còn lại, lượng dùng 7 ngày gần nhất. Chỉ quán có nguyên liệu (Bún đậu).",
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
];

const SUPER_ADMIN_TOOL = {
  name: "get_security_audit",
  description: "Báo cáo bảo mật và danh sách tài khoản quản trị của hệ thống nhà hàng (chỉ Super Admin).",
  parameters: { type: "OBJECT", properties: {} },
};

function getToolsForRole(role: ChatRole) {
  const list = [...BASE_TOOLS];
  if (role === "super_admin") list.push(SUPER_ADMIN_TOOL);
  return [{ functionDeclarations: list }];
}

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
  const hit = pickStore(rows, store);
  if (!hit) throw new Error(`Không tìm thấy cửa hàng "${store}". Cửa hàng bạn xem được: ${rows.map((r) => r.code).join(", ")}`);
  return hit;
}

async function timedTool(authHeader: string, name: string, args: Record<string, unknown>, trace: string[], role: ChatRole) {
  const t0 = Date.now();
  const out = await runTool(authHeader, name, args, role);
  trace.push(`${name} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return out;
}

async function runTool(authHeader: string, name: string, args: Record<string, unknown>, role: ChatRole): Promise<Record<string, unknown>> {
  try {
    if (name === "get_security_audit") {
      if (role !== "super_admin") {
        return { error: "Bạn là Admin cửa hàng. Thông tin bảo mật và cấu hình hệ thống cấp cao chỉ dành riêng cho Super Admin." };
      }
      const users = (await rest(authHeader, "rpc/admin_list_users")) as { email: string; full_name: string; role: string; status: string }[];
      return {
        security_level: "Cao",
        super_admin: SUPER_ADMIN_EMAIL,
        admin_accounts: (users ?? [])
          .filter((u) => u.role === "super_admin" || u.role === "admin")
          .map((u) => ({ email: u.email, name: u.full_name, role: u.role })),
        security_policies: [
          "Row Level Security (RLS) kích hoạt trên toàn bộ các bảng dữ liệu",
          "Giá vốn, doanh thu và chi phí chỉ admin/super_admin được truy cập",
          "Google OAuth xác thực với hàng chờ phê duyệt tài khoản mới",
          "Mã hóa các khóa bảo mật qua Supabase Vault",
          "Phân quyền 3 cấp: Super Admin > Admin > Nhân viên",
        ],
        system_status: "Hệ thống bảo mật và vận hành nhà hàng đang hoạt động bình thường.",
      };
    }
    if (name === "remember") {
      const fact = String(args.fact ?? "").trim().slice(0, 300);
      if (!fact) throw new Error("Ghi nhớ trống");
      const rows = (await rest(authHeader, "assistant_memories", { rpc: { content: fact } })) as Memory[];
      ctxCache.delete(authHeader);
      return { saved: true, id: rows?.[0]?.id, fact };
    }
    if (name === "forget") {
      const id = String(args.id ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("id không hợp lệ");
      const rows = (await rest(authHeader, `assistant_memories?id=eq.${id}`, { method: "DELETE" })) as Memory[];
      ctxCache.delete(authHeader);
      return { deleted: rows.length > 0 };
    }
    const store = await resolveStore(authHeader, args.store);
    if (name === "get_stock") {
      return { store: store.name, rows: await rest(authHeader, "rpc/get_stock_status", { rpc: { p_store_id: store.id } }) };
    }
    if (name === "get_prices") {
      const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const norm = normalizeText;
      const products = (await rest(authHeader, `products?select=id,name,tracks_stock&store_id=eq.${store.id}&is_active=eq.true&order=name`)) as { id: string; name: string }[];
      const want = args.product ? norm(String(args.product)) : "";
      const picked = want ? products.filter((p) => norm(p.name).includes(want)) : products;
      let history: { product_id: string; effective_from: string; sale_price: number | null; app_price: number | null; unit_cost: number | null }[] = [];
      let costVisible = true;
      try {
        history = (await rest(authHeader, `product_prices?select=product_id,effective_from,sale_price,app_price,unit_cost&effective_from=lte.${today}&order=effective_from.desc&limit=2000`)) as typeof history;
      } catch {
        costVisible = false;
        const rows = (await rest(authHeader, "rpc/get_store_prices", { rpc: { p_store_id: store.id, p_date: today } })) as { product_id: string; sale_price: number; app_price: number | null; effective_from: string }[];
        history = rows.map((r) => ({ ...r, unit_cost: null }));
      }
      const items = picked.map((p) => {
        const row = history.find((h) => h.product_id === p.id);
        return { name: p.name, sale_price: row?.sale_price ?? null, partner_price: row?.app_price ?? null, cost: costVisible ? (row?.unit_cost ?? null) : "chỉ admin xem được", applies_from: row?.effective_from ?? null };
      });
      return { store: store.name, date: today, note: "Giá hiện hành theo ngày áp dụng. null = chưa đặt giá. Đơn vị VND.", items };
    }
    if (name === "get_ingredients") {
      const rows = (await rest(authHeader, "rpc/get_ingredient_stock", { rpc: { p_store_id: store.id, p_recent_days: 7 } })) as {
        name: string; unit: string; low_stock_threshold: number; received: number; used: number; on_hand: number; used_recent: number; last_receipt: string | null;
      }[];
      return {
        store: store.name,
        note: "on_hand = đã nhập - đã dùng; đã dùng tính theo số phần món đã bán × công thức. used_recent là lượng dùng 7 ngày gần nhất (chia 7 ra mỗi ngày).",
        items: rows.map((r) => ({ ...r, days_left: r.used_recent > 0 ? Math.floor(r.on_hand / (r.used_recent / 7)) : null })),
      };
    }
    if (name === "get_break_even") {
      return { store: store.name, data: await rest(authHeader, "rpc/get_break_even", { rpc: { p_store_id: store.id } }) };
    }
    const range = validRange(args.from, args.to);
    if (!range) throw new Error("Khoảng ngày không hợp lệ (cần YYYY-MM-DD, từ <= đến).");
    const { from, to } = range;
    if (name === "get_best_sellers") {
      const sales = (await rest(authHeader, `sales?select=channel,sale_items(quantity,unit_price,products(name))&store_id=eq.${store.id}&sale_date=gte.${from}&sale_date=lte.${to}&limit=5000`)) as {
        sale_items: { quantity: number; unit_price: number; products: { name: string } | null }[];
      }[];
      const agg = new Map<string, { qty: number; revenue: number }>();
      for (const sale of sales) for (const it of sale.sale_items) {
        const n = it.products?.name ?? "?";
        const a = agg.get(n) ?? { qty: 0, revenue: 0 };
        a.qty += it.quantity;
        a.revenue += it.quantity * it.unit_price;
        agg.set(n, a);
      }
      const top = [...agg].map(([name, v]) => ({ name, qty: v.qty, revenue: Math.round(v.revenue) })).sort((a, b) => b.qty - a.qty);
      return { store: store.name, from, to, orders: sales.length, top };
    }
    if (name === "get_purchases") {
      const rows = (await rest(authHeader, `stock_batches?select=received_date,initial_qty,unit_cost,products(name)&store_id=eq.${store.id}&received_date=gte.${from}&received_date=lte.${to}&order=received_date&limit=2000`)) as {
        received_date: string; initial_qty: number; unit_cost: number; products: { name: string } | null;
      }[];
      const items = rows.map((r) => ({ date: r.received_date, name: r.products?.name ?? "?", qty: r.initial_qty, unit_cost: r.unit_cost, total: Math.round(r.initial_qty * r.unit_cost) }));
      return { store: store.name, from, to, total: items.reduce((s, i) => s + i.total, 0), items: items.length <= 60 ? items : items.slice(-60), count: items.length };
    }
    if (name === "get_profit_loss") {
      const rows = (await rest(authHeader, "rpc/get_pnl", { rpc: { p_store_id: store.id, p_period: "day", p_from: from, p_to: to } })) as Record<string, number>[];
      const keys = ["gross_revenue", "commission", "net_revenue", "cogs", "gross_profit", "expenses", "net_profit"];
      const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)]));
      const batches = (await rest(authHeader, `stock_batches?select=initial_qty,unit_cost&store_id=eq.${store.id}&received_date=gte.${from}&received_date=lte.${to}&limit=5000`)) as { initial_qty: number; unit_cost: number }[];
      const purchases = Math.round(batches.reduce((s, b) => s + b.initial_qty * b.unit_cost, 0));
      const net = totals.net_revenue;
      return {
        store: store.name, from, to, totals,
        margin_pct: net > 0 ? Math.round((totals.net_profit / net) * 1000) / 10 : null,
        stock_purchases_in_period: purchases,
        formulas: "lãi gộp = doanh thu thuần - giá vốn (FIFO, chỉ tính hàng ĐÃ BÁN); lãi ròng = lãi gộp - chi phí",
        note: "expenses KHÔNG gồm tiền nhập hàng (đã vào giá vốn khi bán, hàng chưa bán nằm trong tồn kho nên chưa tính vào lãi). stock_purchases_in_period là tiền nhập hàng trong kỳ để tham khảo, KHÔNG trừ thêm vào lãi ròng. Đơn vị VND.",
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

// Bộ nhớ đệm ngắn theo người dùng (cùng instance) để các câu hỏi liên tiếp phản hồi siêu tốc
const CTX_TTL_MS = 60 * 1000;
type UserInfo = { id: string; email: string; role: ChatRole; status: string };

const ctxCache = new Map<string, { at: number; catalog?: Catalog; memories?: Memory[]; user?: UserInfo }>();
const fresh = (e: { at: number } | undefined) => !!e && Date.now() - e.at < CTX_TTL_MS;

async function loadUserInfo(authHeader: string): Promise<UserInfo | null> {
  const hit = ctxCache.get(authHeader);
  if (fresh(hit) && hit?.user) return hit.user;

  const payload = parseJwtPayload(authHeader);
  const userEmail = (payload?.email ?? "").trim().toLowerCase();
  const userId = payload?.sub ?? "";

  const isHardcodedSuper = userEmail === SUPER_ADMIN_EMAIL;

  try {
    const rows = (await rest(authHeader, `profiles?id=eq.${userId}&select=id,email,role,status`)) as {
      id: string; email: string | null; role: string; status: string;
    }[];
    const r = rows?.[0];
    const email = (r?.email ?? userEmail).toLowerCase();
    const role: ChatRole = (email === SUPER_ADMIN_EMAIL || r?.role === "super_admin")
      ? "super_admin"
      : r?.role === "admin"
      ? "admin"
      : "staff";

    const user: UserInfo = {
      id: r?.id ?? userId,
      email,
      role,
      status: r?.status ?? "approved",
    };
    ctxCache.set(authHeader, { ...(fresh(hit) ? hit : {}), at: fresh(hit) ? hit!.at : Date.now(), user });
    return user;
  } catch {
    if (isHardcodedSuper && userId) {
      const user: UserInfo = { id: userId, email: userEmail, role: "super_admin", status: "approved" };
      ctxCache.set(authHeader, { ...(fresh(hit) ? hit : {}), at: fresh(hit) ? hit!.at : Date.now(), user });
      return user;
    }
    return null;
  }
}

async function loadCatalog(authHeader: string): Promise<Catalog> {
  const hit = ctxCache.get(authHeader);
  if (fresh(hit) && hit?.catalog) return hit.catalog;
  const value = await fetchCatalog(authHeader);
  const cur = ctxCache.get(authHeader);
  if (value.length) ctxCache.set(authHeader, { ...(fresh(cur) ? cur : {}), at: fresh(cur) ? cur!.at : Date.now(), catalog: value });
  return value;
}

async function fetchCatalog(authHeader: string): Promise<Catalog> {
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
  const hit = ctxCache.get(authHeader);
  if (fresh(hit) && hit?.memories) return hit.memories;
  const value = await fetchMemories(authHeader);
  const cur = ctxCache.get(authHeader);
  ctxCache.set(authHeader, { ...(fresh(cur) ? cur : {}), at: fresh(cur) ? cur!.at : Date.now(), memories: value });
  if (ctxCache.size > 200) ctxCache.delete(ctxCache.keys().next().value as string);
  return value;
}

async function fetchMemories(authHeader: string): Promise<Memory[]> {
  try {
    return (await rest(authHeader, "assistant_memories?select=id,content&order=created_at&limit=30")) as Memory[];
  } catch (err) {
    console.error(`[chat-assistant] memories: ${(err as Error).message}`);
    return [];
  }
}

type Failure = { model: string; status: number | "timeout" | "error"; retryable: boolean; ms?: number };

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
        !/(image|tts|audio|live|embedding|robotics|computer|thinking|exp|preview|omni)/.test(m.name))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""))
      .sort((a: string, b: string) => Number(!/lite/.test(a)) - Number(!/lite/.test(b)) || b.localeCompare(a));
    modelCache = { at: Date.now(), names };
    return names;
  } catch {
    return [];
  }
}

// Tắt hoàn toàn suy nghĩ (thinkingBudget: 0) để tốc độ phản hồi nhanh nhất có thể
const THINKING_MODES: (Record<string, unknown> | null)[] = [{ thinkingBudget: 0 }, { thinkingLevel: "minimal" }, null];
let thinkingMode = 0;
const deadModels = new Set<string>();
const cooldownUntil = new Map<string, number>();
let lastGood: string | null = null;
const COOLDOWN_MS: Record<number, number> = { 429: 120_000, 503: 30_000 };
const available = (m: string) => !deadModels.has(m) && (cooldownUntil.get(m) ?? 0) <= Date.now();

async function callModel(
  apiKey: string,
  model: string,
  system: string,
  contents: Content[],
  timeoutMs: number,
  outer: AbortSignal,
  trace: string[],
  role: ChatRole
): Promise<{ content?: Content; failure?: Failure }> {
  const started = Date.now();
  const tools = getToolsForRole(role);
  const send = (mode: number) =>
    fetch(`${API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
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
      trace.push(`${model} ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (content?.parts?.some((p) => p.text || p.functionCall)) {
        lastGood = model;
        cooldownUntil.delete(model);
        return { content };
      }
      return { failure: { model, status: "error", retryable: true, ms: Date.now() - started } };
    }
    trace.push(`${model} ${res.status} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (res.status === 404) deadModels.add(model);
    if (COOLDOWN_MS[res.status]) cooldownUntil.set(model, Date.now() + COOLDOWN_MS[res.status]);
    const retryable = res.status === 503 || res.status === 429 || res.status === 404 || res.status >= 500;
    return { failure: { model, status: res.status, retryable, ms: Date.now() - started } };
  } catch (err) {
    const name = (err as Error).name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    trace.push(`${model} ${timedOut ? "timeout" : "lỗi"} ${((Date.now() - started) / 1000).toFixed(1)}s`);
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

// Chạy hedge song song để lấy phản hồi nhanh nhất
async function askModels(
  apiKey: string,
  system: string,
  contents: Content[],
  failures: Failure[],
  elapsed: () => number,
  trace: string[],
  role: ChatRole
): Promise<{ content: Content; model: string } | null> {
  const queue = [...new Set([...(lastGood ? [lastGood] : []), ...PREFERRED_MODELS])].filter(available);
  const discovery = discoverModels(apiKey).then((names) => {
    for (const m of names) if (!queue.includes(m) && available(m)) queue.push(m);
    if (queue.length === 0) for (const m of [...PREFERRED_MODELS, ...names]) if (!deadModels.has(m) && !queue.includes(m)) queue.push(m);
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
      if (next >= queue.length || left < 2000) {
        if (inflight === 0) finish(null);
        return;
      }
      const model = queue[next++];
      inflight++;
      const ac = new AbortController();
      controllers.push(ac);
      timer = setTimeout(launch, HEDGE_MS);
      const { content, failure } = await callModel(apiKey, model, system, contents, Math.min(ATTEMPT_TIMEOUT_MS, left), ac.signal, trace, role);
      inflight--;
      if (finished) return;
      if (content) return finish({ content, model });
      if (failure) failures.push(failure);
      if (failure && !failure.retryable) return finish(null);
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

      // Xác thực và lấy vai trò người dùng song song cùng lúc với nạp danh mục và ghi nhớ
      const trace: string[] = [];
      const ctxStart = Date.now();
      const [user, catalog, memories] = await Promise.all([
        loadUserInfo(authHeader),
        loadCatalog(authHeader),
        loadMemories(authHeader),
      ]);
      trace.push(`ngữ cảnh ${((Date.now() - ctxStart) / 1000).toFixed(1)}s`);

      if (!user || user.status === "rejected") {
        return reply({ answer: "Bạn cần đăng nhập vào Sổ Xanh để trò chuyện cùng Roona nhé!", isError: true, durationMs: elapsed() });
      }

      let body: { question?: string; history?: unknown; lang?: string };
      try {
        body = await req.json();
      } catch {
        return reply({ answer: "Dữ liệu gửi lên không hợp lệ", isError: true, durationMs: elapsed() });
      }
      const question = (body.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
      if (!question) return reply({ answer: "Vui lòng nhập câu hỏi", isError: true, durationMs: elapsed() });

      // =========================================================================
      // BẢO VỆ PHÂN QUYỀN CHẶT CHẼ & TỐI ƯU SIÊU TỐC:
      // Admin hoặc Staff hỏi bảo mật -> Trả lời dứt khoát ngay (0ms roundtrip)
      // =========================================================================
      if (user.role !== "super_admin" && isSecurityQuery(question)) {
        const refusal =
          user.role === "admin"
            ? "Bạn đang đăng nhập với vai trò Admin cửa hàng. Các thông tin về bảo mật và cấu hình hệ thống cấp cao chỉ dành riêng cho Super Admin. Vui lòng liên hệ Super Admin nếu bạn cần hỗ trợ."
            : "Bạn đang đăng nhập với vai trò Nhân viên. Các thông tin về bảo mật chỉ dành riêng cho Super Admin.";
        return reply({
          answer: refusal,
          durationMs: elapsed(),
          trace: "chặn quyền bảo mật 0.0s",
        });
      }

      const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
      if (!apiKey) {
        return reply({
          answer: "Chưa cấu hình GEMINI_API_KEY trên Supabase Secrets. Chạy lệnh: `npx supabase secrets set GEMINI_API_KEY=your_key` để kích hoạt.",
          notConfigured: true,
          durationMs: elapsed(),
        });
      }

      const failures: Failure[] = [];
      const system = systemInstruction(catalog, memories, String(body.lang ?? "vi"), user.role);
      const contents: Content[] = historyContents(body.history);
      if (contents.at(-1)?.role === "user") contents.push({ role: "model", parts: [{ text: "(đã ghi nhận)" }] });
      contents.push({ role: "user", parts: [{ text: sanitizeText(question) }] });

      // Vòng lặp gọi model và xử lý tool calls
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const won = await askModels(apiKey, system, contents, failures, elapsed, trace, user.role);
        if (!won) break;
        const calls = won.content.parts.filter((p) => p.functionCall);
        if (calls.length === 0) {
          const text = won.content.parts.map((p) => p.text ?? "").join("").trim();
          return reply({ answer: sanitizeText(text), model: won.model, durationMs: elapsed(), trace: trace.join(" · ") });
        }
        contents.push(won.content);
        const responses = await Promise.all(
          calls.map(async (c) => ({
            functionResponse: {
              name: c.functionCall!.name,
              response: await timedTool(authHeader, c.functionCall!.name, c.functionCall!.args ?? {}, trace, user.role),
            },
          })),
        );
        contents.push({ role: "user", parts: responses });
      }

      return reply({ answer: friendlyError(failures), isError: true, durationMs: elapsed(), trace: trace.join(" · ") });
    } catch (globalErr) {
      console.error(`[chat-assistant] ${(globalErr as Error).message}`);
      return reply({ answer: "Trợ lý gặp lỗi hệ thống. Bạn thử lại sau.", isError: true, durationMs: elapsed() });
    }
  },
};
