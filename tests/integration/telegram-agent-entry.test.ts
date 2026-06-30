import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { TelegramBotClient } from "@/lib/telegram/client";
import { buildTripSwitchKeyboard } from "@/lib/telegram/commands";
import { handleTelegramUpdate } from "@/lib/telegram/handler";
import {
  formatTripListMessage,
  formatUnboundMessage,
} from "@/lib/telegram/messages";
import type { TelegramAgentBridge } from "@/lib/telegram/agent-bridge";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { ensureTestDatabase } from "./test-db";

describe("telegram agent update handler", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(async () => {
    await prisma.telegramChatState.deleteMany();
    await prisma.agentMessage.deleteMany();
    await prisma.agentToolCall.deleteMany();
    await prisma.reminderJob.deleteMany();
    await prisma.tripLeg.deleteMany();
    await prisma.tripStop.deleteMany();
    await prisma.agentSession.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  });

  it("replies with binding instructions for an unbound /start without creating agent state", async () => {
    const chatId = uniqueChatId("unbound");
    const bot = createMockBot();
    const agentBridge = createMockAgentBridge();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/start"),
      bot,
      agentBridge,
    });

    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: formatUnboundMessage(chatId),
    });
    expect(agentBridge.startPlanning).not.toHaveBeenCalled();
    await expect(
      prisma.telegramChatState.findUnique({ where: { chatId } })
    ).resolves.toBeNull();
    await expect(prisma.agentSession.count()).resolves.toBe(0);
    await expect(prisma.trip.count()).resolves.toBe(0);
  });

  it("starts a new planning session from /new prompt and stores the active conversation", async () => {
    const chatId = uniqueChatId("new-prompt");
    const user = await createTelegramUser("new-prompt", chatId);
    const trip = await createTrip(user.id, "Office commute", "planning");
    const session = await createAgentSession(user.id, "completed", trip.id);
    const bot = createMockBot();
    const agentBridge = createMockAgentBridge();
    agentBridge.startPlanning.mockResolvedValue({
      sessionId: session.id,
      tripId: trip.id,
      summary: "Planning summary.",
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/new arrive at office by 9"),
      bot,
      agentBridge,
    });

    expect(agentBridge.startPlanning).toHaveBeenCalledWith({
      userId: user.id,
      prompt: "arrive at office by 9",
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeAgentSessionId: session.id,
      activeTripId: trip.id,
      mode: "active",
    });
    expect(bot.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ chatId, text: expect.stringContaining("\u5df2\u5f00\u59cb") })
    );
    expect(bot.sendMessage).toHaveBeenNthCalledWith(2, {
      chatId,
      text: "Planning summary.",
    });
  });

  it("sets awaiting_new_prompt mode when /new has no prompt", async () => {
    const chatId = uniqueChatId("awaiting");
    const user = await createTelegramUser("awaiting", chatId);
    const bot = createMockBot();
    const agentBridge = createMockAgentBridge();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/new"),
      bot,
      agentBridge,
    });

    expect(agentBridge.startPlanning).not.toHaveBeenCalled();
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      userId: user.id,
      activeAgentSessionId: null,
      activeTripId: null,
      mode: "awaiting_new_prompt",
    });
    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        text: expect.stringContaining("\u65b0\u7684\u51fa\u884c\u9700\u6c42"),
      })
    );
  });

  it("continues an active completed session from plain text and updates the active trip", async () => {
    const chatId = uniqueChatId("continue");
    const user = await createTelegramUser("continue", chatId);
    const oldTrip = await createTrip(user.id, "Old commute", "monitoring");
    const nextTrip = await createTrip(user.id, "Updated commute", "monitoring");
    const session = await createAgentSession(user.id, "completed", oldTrip.id);
    await createChatState(chatId, user.id, session.id, oldTrip.id, "active");
    const bot = createMockBot();
    const agentBridge = createMockAgentBridge();
    agentBridge.continueSession.mockResolvedValue({
      sessionId: session.id,
      tripId: nextTrip.id,
      summary: "Updated summary.",
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "leave ten minutes earlier"),
      bot,
      agentBridge,
    });

    expect(agentBridge.continueSession).toHaveBeenCalledWith({
      userId: user.id,
      sessionId: session.id,
      message: "leave ten minutes earlier",
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeAgentSessionId: session.id,
      activeTripId: nextTrip.id,
      mode: "active",
    });
    expect(bot.sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ chatId, text: expect.stringContaining("\u7ee7\u7eed") })
    );
    expect(bot.sendMessage).toHaveBeenNthCalledWith(2, {
      chatId,
      text: "Updated summary.",
    });
  });

  it("rejects plain text while the active agent session is running", async () => {
    const chatId = uniqueChatId("running");
    const user = await createTelegramUser("running", chatId);
    const session = await createAgentSession(user.id, "running", null);
    await createChatState(chatId, user.id, session.id, null, "active");
    const bot = createMockBot();
    const agentBridge = createMockAgentBridge();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "continue planning"),
      bot,
      agentBridge,
    });

    expect(agentBridge.continueSession).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: expect.stringContaining("\u667a\u80fd\u4f53\u8fd8\u5728\u5904\u7406"),
    });
  });

  it("lists switchable trips with an inline switch keyboard", async () => {
    const chatId = uniqueChatId("trips");
    const user = await createTelegramUser("trips", chatId);
    const trip = await createTrip(user.id, "Library commute", "monitoring");
    const bot = createMockBot();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/trips"),
      bot,
      agentBridge: createMockAgentBridge(),
    });

    const summaries = [
      {
        id: trip.id,
        title: trip.title,
        status: trip.status,
        targetArriveAt: trip.targetArriveAt,
        scheduledReminderCount: 0,
      },
    ];
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: formatTripListMessage(summaries),
      replyMarkup: buildTripSwitchKeyboard([
        { id: trip.id, title: "Library commute" },
      ]),
    });
  });

  it("switches active trip from sw callback data and sends callback plus message confirmations", async () => {
    const chatId = uniqueChatId("callback");
    const user = await createTelegramUser("callback", chatId);
    const trip = await createTrip(user.id, "Airport commute", "monitoring");
    const bot = createMockBot();

    await handleTelegramUpdate({
      update: callbackUpdate(chatId, "callback-1", `sw:${trip.id}`),
      bot,
      agentBridge: createMockAgentBridge(),
    });

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: "callback-1",
      text: `\u5df2\u5207\u6362\u5230\uff1a${trip.title}`,
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeTripId: trip.id,
      mode: "active",
    });
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: expect.stringContaining("\u540e\u7eed\u666e\u901a\u6d88\u606f"),
    });
  });

  it("answers invalid callbacks without changing active state", async () => {
    const chatId = uniqueChatId("bad-callback");
    const user = await createTelegramUser("bad-callback", chatId);
    const trip = await createTrip(user.id, "Keep current", "monitoring");
    const session = await createAgentSession(user.id, "completed", trip.id);
    await createChatState(chatId, user.id, session.id, trip.id, "active");
    const bot = createMockBot();

    await handleTelegramUpdate({
      update: callbackUpdate(chatId, "callback-bad", "unknown"),
      bot,
      agentBridge: createMockAgentBridge(),
    });

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: "callback-bad",
      text: "\u8fd9\u4e2a\u6309\u94ae\u5df2\u4e0d\u53ef\u7528\u3002",
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeAgentSessionId: session.id,
      activeTripId: trip.id,
      mode: "active",
    });
  });
});

function createMockBot() {
  return {
    getUpdates: vi.fn(),
    sendMessage: vi.fn(async () => undefined),
    answerCallbackQuery: vi.fn(async () => undefined),
  } satisfies TelegramBotClient;
}

function createMockAgentBridge() {
  return {
    startPlanning: vi.fn(),
    continueSession: vi.fn(),
  } satisfies TelegramAgentBridge;
}

function messageUpdate(chatId: string, text?: string): TelegramUpdate {
  return {
    update_id: Number(Date.now()),
    message: {
      message_id: Number(Date.now()),
      chat: { id: chatId },
      text,
    },
  };
}

function callbackUpdate(
  chatId: string,
  callbackQueryId: string,
  data: string
): TelegramUpdate {
  return {
    update_id: Number(Date.now()),
    callback_query: {
      id: callbackQueryId,
      data,
      message: {
        message_id: Number(Date.now()),
        chat: { id: chatId },
      },
    },
  };
}

function uniqueChatId(label: string) {
  return `${label}-${Date.now()}-${Math.random()}`;
}

async function createTelegramUser(label: string, chatId: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "home",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
          telegramChatId: chatId,
        },
      },
    },
  });
}

async function createTrip(userId: string, title: string, status: string) {
  return prisma.trip.create({
    data: {
      userId,
      title,
      rawPrompt: title,
      status,
      timezone: "Asia/Shanghai",
      targetArriveAt: new Date("2026-07-01T01:00:00.000Z"),
    },
  });
}

async function createAgentSession(
  userId: string,
  status: string,
  tripId: string | null
) {
  return prisma.agentSession.create({
    data: {
      userId,
      tripId,
      status,
      purpose: "telegram_test",
      prompt: "Initial prompt",
    },
  });
}

async function createChatState(
  chatId: string,
  userId: string,
  activeAgentSessionId: string,
  activeTripId: string | null,
  mode: string
) {
  return prisma.telegramChatState.create({
    data: {
      chatId,
      userId,
      activeAgentSessionId,
      activeTripId,
      mode,
    },
  });
}
