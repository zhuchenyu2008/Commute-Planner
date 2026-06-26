import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { sendEmail, sendTelegram } from "@/lib/notifications/channels";

export async function POST(request: Request) {
  return withAuth(async () => {
    const body = await request.json().catch(() => ({}));
    const channel = String(body.channel || "telegram");
    const result =
      channel === "email"
        ? await sendEmail("通勤助手测试邮件", "这是一封来自通勤规划助手的测试通知。")
        : await sendTelegram("通勤规划助手测试通知");
    return apiOk({ result });
  });
}
