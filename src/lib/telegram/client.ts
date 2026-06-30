import type {
  TelegramInlineKeyboardMarkup,
  TelegramSendMessageInput,
  TelegramUpdate,
} from "./types";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export class TelegramBotApiError extends Error {
  constructor(method: string, status: number, description?: string) {
    super(
      description
        ? `Telegram ${method} ${status}: ${description}`
        : `Telegram ${method} request failed with ${status}`
    );
    this.name = "TelegramBotApiError";
  }
}

export type TelegramBotClient = {
  getUpdates(input: {
    offset?: number | null;
    timeoutSeconds?: number;
  }): Promise<TelegramUpdate[]>;
  sendMessage(input: TelegramSendMessageInput): Promise<void>;
  answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void>;
};

export function createTelegramBotClient(input: { token: string }): TelegramBotClient {
  const baseUrl = `https://api.telegram.org/bot${input.token}`;

  async function request<T>(method: string, body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | TelegramApiResponse<T>
      | null;

    if (!response.ok || !payload?.ok) {
      throw new TelegramBotApiError(
        method,
        response.status,
        payload?.description
      );
    }

    return payload.result as T;
  }

  return {
    getUpdates({ offset, timeoutSeconds = 30 }) {
      return request<TelegramUpdate[]>("getUpdates", {
        offset: offset ?? undefined,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      });
    },
    async sendMessage({ chatId, text, replyMarkup }) {
      await request("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });
    },
    async answerCallbackQuery({ callbackQueryId, text, showAlert = false }) {
      await request("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    },
  };
}

export type { TelegramInlineKeyboardMarkup };
