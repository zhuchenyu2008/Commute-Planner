import { clearSessionCookie } from "@/lib/auth/session";
import { apiOk } from "@/lib/http/api";

export async function POST() {
  await clearSessionCookie();
  return apiOk({ ok: true });
}
