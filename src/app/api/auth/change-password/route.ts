import { apiError, apiOk } from "@/lib/http/api";
import { verifyPassword, setPassword } from "@/lib/auth/session";
import { withAuth } from "@/lib/auth/api-guard";

export async function POST(request: Request) {
  return withAuth(async () => {
    const body = await request.json().catch(() => ({}));
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) {
      return apiError("BAD_REQUEST", "新密码至少需要 8 位", 400);
    }
    const valid = await verifyPassword(currentPassword);
    if (!valid) {
      return apiError("UNAUTHORIZED", "当前密码不正确", 401);
    }
    await setPassword(newPassword);
    return apiOk({ ok: true });
  });
}
