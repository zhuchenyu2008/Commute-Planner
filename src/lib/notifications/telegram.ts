import type { NotificationSendStatus } from "./log";

export type TelegramSendInput = {
  text: string;
  chatId?: string | null;
};

export type NotificationSendResult = {
  status: NotificationSendStatus;
  recipient?: string | null;
  error?: string;
};

const hasValue = (value: string | undefined | null): value is string =>
  typeof value === "string" && value.trim().length > 0;

export async function sendTelegram({
  text,
  chatId,
}: TelegramSendInput): Promise<NotificationSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const recipient = chatId ?? process.env.TELEGRAM_CHAT_ID ?? null;

  if (!hasValue(token) || !hasValue(recipient)) {
    return { status: "skipped", recipient };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: recipient,
          text,
          disable_web_page_preview: true,
        }),
      }
    );

    if (!response.ok) {
      return {
        status: "failed",
        recipient,
        error: `Telegram request failed with ${response.status}`,
      };
    }

    return { status: "sent", recipient };
  } catch (error) {
    return {
      status: "failed",
      recipient,
      error: error instanceof Error ? error.message : "Telegram request failed",
    };
  }
}
