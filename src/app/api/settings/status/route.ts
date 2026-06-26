import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { env, hasAmapConfig, hasOpenAIConfig, hasSmtpConfig, hasTelegramConfig } from "@/lib/env";

export async function GET() {
  return withAuth(async () => {
    return apiOk({
      amap: hasAmapConfig(),
      model: hasOpenAIConfig(),
      telegram: hasTelegramConfig(),
      smtp: hasSmtpConfig(),
      databaseUrl: env.databaseUrl.replace(/[^/\\]+$/, "commute.db"),
      appVersion: process.env.npm_package_version || "0.1.0"
    });
  });
}
