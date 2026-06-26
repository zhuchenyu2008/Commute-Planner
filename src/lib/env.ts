export const env = {
  databaseUrl: process.env.DATABASE_URL || "file:./data/commute.db",
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-change-me-please-32",
  appPasswordHash: process.env.APP_PASSWORD_HASH || "",
  appInitialPassword: process.env.APP_INITIAL_PASSWORD || "change-me-now",
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY || "",
  openaiCompatBaseUrl: process.env.OPENAI_COMPAT_BASE_URL || "",
  openaiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY || "",
  openaiCompatModel: process.env.OPENAI_COMPAT_MODEL || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || "587"),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "",
  recipientEmail: process.env.RECIPIENT_EMAIL || ""
};

export function hasOpenAIConfig() {
  return Boolean(env.openaiCompatBaseUrl && env.openaiCompatApiKey && env.openaiCompatModel);
}

export function hasAmapConfig() {
  return Boolean(env.amapWebServiceKey);
}

export function hasTelegramConfig() {
  return Boolean(env.telegramBotToken && env.telegramChatId);
}

export function hasSmtpConfig() {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFrom && env.recipientEmail);
}
