import { apiError, apiOk } from "@/lib/http/api";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!password) {
    return apiError("BAD_REQUEST", "请输入密码", 400);
  }
  const valid = await verifyPassword(password);
  if (!valid) {
    return apiError("UNAUTHORIZED", "密码不正确", 401);
  }
  const token = await createSession();
  await setSessionCookie(token);
  return apiOk({ ok: true });
}
