import { afterEach, describe, expect, it, vi } from "vitest";
import {
  processTelegramPollingBatch,
  runTelegramPolling,
} from "@/lib/telegram/polling";
import type { TelegramBotClient } from "@/lib/telegram/client";

const telegramMocks = vi.hoisted(() => ({
  createTelegramBotClient: vi.fn(),
  getNextTelegramOffset: vi.fn(),
  handleTelegramUpdate: vi.fn(),
  markTelegramUpdateProcessed: vi.fn(),
}));

vi.mock("@/lib/telegram/client", () => ({
  createTelegramBotClient: telegramMocks.createTelegramBotClient,
}));

vi.mock("@/lib/telegram/handler", () => ({
  handleTelegramUpdate: telegramMocks.handleTelegramUpdate,
}));

vi.mock("@/lib/telegram/state", () => ({
  getNextTelegramOffset: telegramMocks.getNextTelegramOffset,
  markTelegramUpdateProcessed: telegramMocks.markTelegramUpdateProcessed,
}));

describe("telegram polling", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches updates from the current offset and marks each processed update", async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([
        {
          update_id: 10,
          message: { message_id: 1, chat: { id: "chat" }, text: "/start" },
        },
        {
          update_id: 11,
          message: { message_id: 2, chat: { id: "chat" }, text: "/status" },
        },
      ]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    const markProcessed = vi.fn().mockResolvedValue(undefined);

    const processed = await processTelegramPollingBatch({
      bot,
      offset: 10,
      timeoutSeconds: 1,
      handleUpdate: handler,
      markProcessed,
    });

    expect(processed).toBe(2);
    expect(bot.getUpdates).toHaveBeenCalledWith({ offset: 10, timeoutSeconds: 1 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(markProcessed).toHaveBeenCalledWith(10);
    expect(markProcessed).toHaveBeenCalledWith(11);
  });

  it("passes the abort signal to getUpdates", async () => {
    const signal = new AbortController().signal;
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };

    await processTelegramPollingBatch({
      bot,
      offset: 30,
      timeoutSeconds: 1,
      signal,
      handleUpdate: vi.fn(),
      markProcessed: vi.fn(),
    });

    expect(bot.getUpdates).toHaveBeenCalledWith({
      offset: 30,
      timeoutSeconds: 1,
      signal,
    });
  });

  it("does not mark an update processed when its handler fails", async () => {
    const markProcessed = vi.fn();
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([
        {
          update_id: 12,
          message: { message_id: 1, chat: { id: "chat" }, text: "/start" },
        },
      ]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };

    await expect(
      processTelegramPollingBatch({
        bot,
        offset: 12,
        timeoutSeconds: 1,
        handleUpdate: vi.fn().mockRejectedValue(new Error("handler failed")),
        markProcessed,
      })
    ).rejects.toThrow("handler failed");

    expect(markProcessed).not.toHaveBeenCalled();
  });

  it("stops processing after a failed update without marking it processed", async () => {
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockResolvedValue([
        {
          update_id: 20,
          message: { message_id: 1, chat: { id: "chat" }, text: "/start" },
        },
        {
          update_id: 21,
          message: { message_id: 2, chat: { id: "chat" }, text: "/status" },
        },
      ]),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("second failed"));
    const markProcessed = vi.fn().mockResolvedValue(undefined);

    await expect(
      processTelegramPollingBatch({
        bot,
        offset: 20,
        timeoutSeconds: 1,
        handleUpdate: handler,
        markProcessed,
      })
    ).rejects.toThrow("second failed");

    expect(handler).toHaveBeenCalledTimes(2);
    expect(markProcessed).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledWith(20);
    expect(markProcessed).not.toHaveBeenCalledWith(21);
  });

  it("resolves when an in-flight long poll is aborted", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const bot: TelegramBotClient = {
      getUpdates: vi.fn().mockRejectedValue(abortError),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    const controller = new AbortController();

    telegramMocks.createTelegramBotClient.mockReturnValue(bot);
    telegramMocks.getNextTelegramOffset.mockResolvedValue(40);

    await expect(
      runTelegramPolling({
        token: "token",
        timeoutSeconds: 1,
        idleDelayMs: 0,
        signal: controller.signal,
      })
    ).resolves.toBeUndefined();

    expect(bot.getUpdates).toHaveBeenCalledWith({
      offset: 40,
      timeoutSeconds: 1,
      signal: controller.signal,
    });
  });

  it("keeps polling after a transient non-abort error", async () => {
    const pollingError = new Error("network failed");
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const bot: TelegramBotClient = {
      getUpdates: vi
        .fn()
        .mockRejectedValueOnce(pollingError)
        .mockRejectedValueOnce(abortError),
      sendMessage: vi.fn(),
      answerCallbackQuery: vi.fn(),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    telegramMocks.createTelegramBotClient.mockReturnValue(bot);
    telegramMocks.getNextTelegramOffset.mockResolvedValue(50);

    await expect(
      runTelegramPolling({
        token: "token",
        timeoutSeconds: 1,
        idleDelayMs: 0,
      })
    ).resolves.toBeUndefined();

    expect(bot.getUpdates).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      "Telegram polling failed; retrying.",
      pollingError
    );
  });
});
