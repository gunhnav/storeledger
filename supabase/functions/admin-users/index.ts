// Quản lý tài khoản nhân viên (chỉ admin): tạo tài khoản, sửa tên / email, đặt lại mật khẩu.
// Cần secret key nên không làm được từ trình duyệt; client gọi qua supabase.functions.invoke('admin-users').
import "@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "@supabase/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body =
  | { action: "create"; email: string; password: string; full_name: string; store_ids: string[]; role?: "super_admin" | "admin" | "staff" }
  | { action: "set_password"; user_id: string; password: string }
  | { action: "update"; user_id: string; full_name: string; email: string };

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function fail(message: string, status = 400) {
  return reply({ error: message }, status);
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") return fail("Chỉ nhận POST", 405);

    const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
    if (authError) return fail("Bạn cần đăng nhập", authError.status ?? 401);

    // Kiểm tra admin bằng client của chính người gọi (theo RLS / auth.uid())
    const { data: isAdmin, error: adminError } = await ctx.supabase.rpc("is_admin");
    if (adminError) return fail(adminError.message, 500);
    if (!isAdmin) return fail("Chỉ admin được quản lý tài khoản", 403);

    const { data: isSuperAdmin } = await ctx.supabase.rpc("is_super_admin");
    const callerIsSuper = Boolean(isSuperAdmin);

    const { data: callerAuth } = await ctx.supabase.auth.getUser();
    const callerUserId = callerAuth?.user?.id;

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return fail("Dữ liệu gửi lên không hợp lệ");
    }

    // Kiểm tra bảo vệ cấp bậc tài khoản khi cập nhật hoặc đổi mật khẩu
    if (body.action === "update" || body.action === "set_password") {
      if (!body.user_id) return fail("Thiếu tài khoản cần thao tác");

      const { data: targetProfile, error: targetError } = await ctx.supabase
        .from("profiles")
        .select("id, email, role, status")
        .eq("id", body.user_id)
        .maybeSingle();

      if (targetError) return fail(targetError.message, 500);
      if (!targetProfile) return fail("Không tìm thấy tài khoản", 404);

      const targetRole = targetProfile.role;
      const targetEmail = (targetProfile.email ?? "").trim().toLowerCase();
      const masterEmail = (Deno.env.get("MASTER_ADMIN_EMAIL") ?? "").trim().toLowerCase();
      const isTargetSuper = targetRole === "super_admin" || (masterEmail && targetEmail === masterEmail);

      // Phân quyền cấp bậc:
      // 1. Chỉ Super Admin mới được đổi mật khẩu/thông tin của Super Admin
      // 2. Admin thường không được can thiệp vào tài khoản admin khác (chỉ được tự đổi của mình hoặc nhân viên)
      if (!callerIsSuper) {
        if (isTargetSuper) {
          return fail("Chỉ Super Admin mới được thay đổi tài khoản Super Admin", 403);
        }
        if (targetRole === "admin" && body.user_id !== callerUserId) {
          return fail("Chỉ Super Admin mới được thay đổi tài khoản quản trị viên khác", 403);
        }
      }
    }

    if (body.action === "update") {
      const email = (body.email ?? "").trim().toLowerCase();
      const fullName = (body.full_name ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Email không hợp lệ");
      if (!fullName) return fail("Nhập tên nhân viên");
      if (fullName.length > 100) return fail("Tên tối đa 100 ký tự");

      // Đổi email đăng nhập ngay (admin đã xác nhận), không cần nhân viên bấm link
      const { error: authUpdateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(body.user_id, {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (authUpdateError) {
        const exists = /already|registered|exists/i.test(authUpdateError.message);
        return fail(exists ? "Email này đã có tài khoản khác dùng" : authUpdateError.message);
      }
      // service_role không ghi được bảng public: đổi tên qua hàm SECURITY DEFINER bằng phiên admin
      const { error: profileError } = await ctx.supabase.rpc("admin_set_full_name", {
        p_user_id: body.user_id,
        p_full_name: fullName,
      });
      if (profileError) return fail(profileError.message);
      return reply({ ok: true });
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 6) return fail("Mật khẩu phải có ít nhất 6 ký tự");

    if (body.action === "set_password") {
      const { error } = await ctx.supabaseAdmin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return fail(error.message);
      return reply({ ok: true });
    }

    if (body.action !== "create") return fail("Thao tác không hợp lệ");

    const email = (body.email ?? "").trim().toLowerCase();
    const fullName = (body.full_name ?? "").trim();
    const role = body.role === "super_admin" ? "super_admin" : body.role === "admin" ? "admin" : "staff";
    if (role === "super_admin" && !callerIsSuper) {
      return fail("Chỉ Super Admin mới được tạo tài khoản Super Admin", 403);
    }
    // Admin thấy mọi cửa hàng theo role, không cần gán cửa hàng
    const storeIds = role === "staff" && Array.isArray(body.store_ids) ? body.store_ids : [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Email không hợp lệ");
    if (!fullName) return fail("Nhập tên nhân viên");

    // Trigger handle_new_user tạo profile với role 'staff' và full_name từ metadata
    const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError) {
      const exists = /already|registered|exists/i.test(createError.message);
      return fail(exists ? "Email này đã có tài khoản" : createError.message);
    }

    const userId = created.user.id;
    if (role === "admin" || role === "super_admin") {
      const { error } = await ctx.supabase.rpc("admin_set_role", { p_user_id: userId, p_role: role });
      if (error) {
        await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
        return fail(error.message);
      }
    }
    if (storeIds.length > 0) {
      // Ghi bằng client của admin đang gọi: RLS store_members_insert_admin cho phép,
      // service_role của project không có quyền ghi bảng public
      const { error } = await ctx.supabase
        .from("store_members")
        .insert(storeIds.map((store_id) => ({ store_id, user_id: userId })));
      if (error) {
        // Không để lại tài khoản không thuộc cửa hàng nào khi gán lỗi
        await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
        return fail(error.message);
      }
    }

    return reply({ ok: true, user_id: userId });
  },
};
