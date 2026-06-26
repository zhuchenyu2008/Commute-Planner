import { apiOk } from "@/lib/http/api";
import { getSessionFromCookies } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromCookies();
  return apiOk({ authenticated: Boolean(session) });
}
