import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramBotClient, TelegramBotApiError } from "@/lib/telegram/client";

describe("Telegram Bot API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches message and callback_query updates with the next offset", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 11,
              message: { message_id: 7, chat: { id: 123 }, text: "/start" },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const client = createTelegramBotClient({ token: "token" });

    const updates = await client.getUpdates({ offset: 10, timeoutSeconds: 20 });

    expect(updates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/getUpdates",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          offset: 10,
          timeout: 20,
          allowed_updates: ["message", "callback_query"],
        }),
      })
    );
  });

  it("sends messages with inline keyboard markup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), {
        status: 200,
      })
    );
    const client = createTelegramBotClient({ token: "token" });

    await client.sendMessage({
      chatId: "123",
      text: "选择行程",
      replyMarkup: {
        inline_keyboard: [[{ text: "切换到此行程", callback_data: "sw:trip1" }]],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "123",
          text: "选择行程",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "切换到此行程", callback_data: "sw:trip1" }]],
          },
        }),
      })
    );
  });

  it("answers callback queries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    );
    const client = createTelegramBotClient({ token: "token" });

    await client.answerCallbackQuery({
      callbackQueryId: "callback-1",
      text: "已切换",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/answerCallbackQuery",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          callback_query_id: "callback-1",
          text: "已切换",
          show_alert: false,
        }),
      })
    );
  });

  it("throws a diagnostic error for Telegram API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Bad Request" }), {
        status: 400,
      })
    );
    const client = createTelegramBotClient({ token: "token" });

    await expect(client.getUpdates({ offset: 1 })).rejects.toThrow(
      TelegramBotApiError
    );
    await expect(client.getUpdates({ offset: 1 })).rejects.toThrow(
      "Telegram getUpdates 400: Bad Request"
    );
  });
});
