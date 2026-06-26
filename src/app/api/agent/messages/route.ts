import { apiError, apiOk, toPublicError } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { planTripFromText } from "@/lib/planning/planner";

export async function POST(request: Request) {
  return withAuth(async () => {
    try {
      const body = await request.json().catch(() => ({}));
      const text = String(body.text || "").trim();
      if (!text) {
        return apiError("BAD_REQUEST", "请输入目的地和到达时间", 400);
      }
      const result = await planTripFromText(text);
      return apiOk(result);
    } catch (error) {
      return apiError("SERVICE_UNAVAILABLE", toPublicError(error), 503);
    }
  });
}
