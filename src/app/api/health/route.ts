import { apiOk } from "@/lib/http/api";

export async function GET() {
  return apiOk({ ok: true, name: "commute-planner" });
}
