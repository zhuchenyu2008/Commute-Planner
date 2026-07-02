import { beforeAll, describe, expect, it, vi } from "vitest";
import { AgentSessionAlreadyRunningError } from "@/lib/agent/planner";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type { TelegramAgentBridge } from "@/lib/telegram/agent-bridge";
import type { TelegramBotClient } from "@/lib/telegram/client";
import { handleTelegramUpdate } from "@/lib/telegram/handler";
import { formatUnboundMessage } from "@/lib/telegram/messages";
import { processTelegramPollingBatch } from "@/lib/telegram/polling";
import {
  getNextTelegramOffset,
  markTelegramUpdateProcessed,
} from "@/lib/telegram/state";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

const getCurrentUserMock = vi.hoisted(
  () => vi.fn<() => Promise<CurrentUser | null>>()
);

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    getCurrentUser: getCurrentUserMock,
  };
});

describe("RUS-026 through RUS-031 Telegram deterministic companion coverage", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("RUS-026: binding instructions, bound help, and duplicate settings rejection", async () => {
    const { PUT } = await import("@app/api/settings/route");
    const chatId = uniqueChatId("rus-026");
    const unboundBot = createMockBot();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/start"),
      bot: unboundBot,
      agentBridge: createMockAgentBridge(),
    });

    expect(unboundBot.sendMessage).toHaveBeenCalledWith({
      chatId,
      text: formatUnboundMessage(chatId),
    });

    const firstUser = await createTelegramUser("rus-026-first", chatId);
    const boundBot = createMockBot();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/start"),
      bot: boundBot,
      agentBridge: createMockAgentBridge(),
    });

    expect(boundBot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        text: expect.stringContaining("/new"),
      })
    );

    const secondUser = await createTelegramUser("rus-026-second", null);
    getCurrentUserMock.mockResolvedValue(secondUser);

    const duplicateResponse = await PUT(
      new Request("http://localhost/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          routePreference: "balanced",
          telegramChatId: chatId,
        }),
      })
    );
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(400);
    expect(duplicateBody.details.join("\n")).toContain("Telegram Chat ID");
    await expect(
      prisma.userSettings.findUniqueOrThrow({ where: { userId: firstUser.id } })
    ).resolves.toMatchObject({ telegramChatId: chatId });
    await expect(
      prisma.userSettings.findUniqueOrThrow({ where: { userId: secondUser.id } })
    ).resolves.toMatchObject({ telegramChatId: null });
  });

  it("RUS-027: /new starts planning, stores active state, and sends route details", async () => {
    const chatId = uniqueChatId("rus-027");
    const user = await createTelegramUser("rus-027", chatId);
    const session = await createAgentSession(user.id, "completed", null);
    const trip = await createDetailedTrip(user.id, "Office commute");
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { tripId: trip.id },
    });
    const bot = createMockBot();
    const bridge = createMockAgentBridge();
    bridge.startPlanning.mockImplementation(async (input) => {
      await input.progress?.onSessionStarted(session.id);
      await input.progress?.onProgressMessage("progress: searching route");
      return {
        sessionId: session.id,
        tripId: trip.id,
        summary: "fallback summary should not be used when trip exists",
      };
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/new tomorrow arrive at office by 9"),
      bot,
      agentBridge: bridge,
    });

    expect(bridge.startPlanning).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        prompt: "tomorrow arrive at office by 9",
      })
    );
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      userId: user.id,
      activeAgentSessionId: session.id,
      activeTripId: trip.id,
      mode: "active",
    });
    expect(lastSentText(bot)).toEqual(expect.stringContaining("Home-Office"));
    expect(lastSentText(bot)).toEqual(expect.stringContaining("Airport Express"));
    expect(lastSentText(bot)).toEqual(expect.stringContaining("Reserve entry time"));
    expect(lastSentText(bot)).toEqual(expect.stringContaining("提醒计划"));
    await expect(
      prisma.trip.findFirst({ where: { id: trip.id, userId: user.id } })
    ).resolves.toMatchObject({ id: trip.id });
    await expect(
      prisma.reminderJob.count({ where: { tripId: trip.id, kind: "depart_now" } })
    ).resolves.toBe(1);
  });

  it("RUS-028: /new without prompt uses the next plain text as a new plan", async () => {
    const chatId = uniqueChatId("rus-028");
    const user = await createTelegramUser("rus-028", chatId);
    const session = await createAgentSession(user.id, "completed", null);
    const trip = await createDetailedTrip(user.id, "School commute");
    const bot = createMockBot();
    const bridge = createMockAgentBridge();
    bridge.startPlanning.mockResolvedValue({
      sessionId: session.id,
      tripId: trip.id,
      summary: "created from awaited prompt",
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/new"),
      bot,
      agentBridge: bridge,
    });

    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      mode: "awaiting_new_prompt",
      activeAgentSessionId: null,
      activeTripId: null,
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "the day after tomorrow arrive at school by 8:30"),
      bot,
      agentBridge: bridge,
    });

    expect(bridge.startPlanning).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        prompt: "the day after tomorrow arrive at school by 8:30",
      })
    );
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      mode: "active",
      activeAgentSessionId: session.id,
      activeTripId: trip.id,
    });
  });

  it("RUS-029: plain text continues current trip and running sessions block duplicates", async () => {
    const chatId = uniqueChatId("rus-029");
    const user = await createTelegramUser("rus-029", chatId);
    const trip = await createDetailedTrip(user.id, "Current commute");
    const session = await createAgentSession(user.id, "completed", trip.id);
    await createChatState(chatId, user.id, session.id, trip.id, "active");
    const bot = createMockBot();
    const bridge = createMockAgentBridge();
    bridge.continueSession.mockResolvedValue({
      sessionId: session.id,
      tripId: trip.id,
      summary: "continued",
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "change arrival to 8:45"),
      bot,
      agentBridge: bridge,
    });

    expect(bridge.continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        sessionId: session.id,
        message: "change arrival to 8:45",
      })
    );

    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "running" },
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "duplicate while running"),
      bot,
      agentBridge: bridge,
    });

    expect(bridge.continueSession).toHaveBeenCalledTimes(1);
    expect(lastSentText(bot)).toEqual(
      expect.stringContaining("\u667a\u80fd\u4f53\u8fd8\u5728\u5904\u7406")
    );
  });

  it("RUS-029 bridge guard: running continuation errors produce a retry message", async () => {
    const chatId = uniqueChatId("rus-029-bridge");
    const user = await createTelegramUser("rus-029-bridge", chatId);
    const trip = await createDetailedTrip(user.id, "Bridge guarded commute");
    const session = await createAgentSession(user.id, "completed", trip.id);
    await createChatState(chatId, user.id, session.id, trip.id, "active");
    const bot = createMockBot();
    const bridge = createMockAgentBridge();
    bridge.continueSession.mockRejectedValue(new AgentSessionAlreadyRunningError());

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "continue while bridge says running"),
      bot,
      agentBridge: bridge,
    });

    expect(lastSentText(bot)).toEqual(expect.stringContaining("\u7a0d\u540e"));
  });

  it("RUS-030: /trips callback switches active trip and follow-up text uses it", async () => {
    const chatId = uniqueChatId("rus-030");
    const user = await createTelegramUser("rus-030", chatId);
    const firstTrip = await createDetailedTrip(user.id, "First commute");
    const secondTrip = await createDetailedTrip(user.id, "Second commute");
    const firstSession = await createAgentSession(user.id, "completed", firstTrip.id);
    await createChatState(chatId, user.id, firstSession.id, firstTrip.id, "active");
    const bot = createMockBot();
    const bridge = createMockAgentBridge();
    bridge.continueSession.mockImplementation(async (input) => ({
      sessionId: input.sessionId,
      tripId: secondTrip.id,
      summary: "updated selected trip",
    }));

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/trips"),
      bot,
      agentBridge: bridge,
    });

    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ callback_data: `sw:${secondTrip.id}` }),
            ]),
          ]),
        }),
      })
    );

    await handleTelegramUpdate({
      update: callbackUpdate(chatId, "switch-second", `sw:${secondTrip.id}`),
      bot,
      agentBridge: bridge,
    });

    const switchedState = await prisma.telegramChatState.findUniqueOrThrow({
      where: { chatId },
    });
    expect(switchedState.activeTripId).toBe(secondTrip.id);
    expect(switchedState.activeAgentSessionId).toEqual(expect.any(String));

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "cancel monitoring later"),
      bot,
      agentBridge: bridge,
    });

    expect(bridge.continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: switchedState.activeAgentSessionId,
        message: "cancel monitoring later",
      })
    );

    await handleTelegramUpdate({
      update: callbackUpdate(chatId, "stale-switch", "sw:not-a-real-trip"),
      bot,
      agentBridge: bridge,
    });

    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith({
      callbackQueryId: "stale-switch",
      text: expect.any(String),
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({ activeTripId: secondTrip.id });
  });

  it("RUS-031: status reports active state, cancel clears it, second cancel is harmless", async () => {
    const chatId = uniqueChatId("rus-031");
    const user = await createTelegramUser("rus-031", chatId);
    const bot = createMockBot();
    const bridge = createMockAgentBridge();

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/status"),
      bot,
      agentBridge: bridge,
    });

    expect(lastSentText(bot)).toEqual(expect.stringContaining("/new"));

    const trip = await createDetailedTrip(user.id, "Cancelable commute");
    const session = await createAgentSession(user.id, "completed", trip.id);
    await createChatState(chatId, user.id, session.id, trip.id, "active");

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/status"),
      bot,
      agentBridge: bridge,
    });

    expect(lastSentText(bot)).toEqual(expect.stringContaining(trip.id));

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/cancel"),
      bot,
      agentBridge: bridge,
    });

    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeAgentSessionId: null,
      activeTripId: null,
      mode: "idle",
    });

    await handleTelegramUpdate({
      update: messageUpdate(chatId, "/cancel"),
      bot,
      agentBridge: bridge,
    });

    expect(lastSentText(bot)).toEqual(
      expect.stringContaining("\u6ca1\u6709\u53ef\u53d6\u6d88")
    );
  });

  it("RUS-026 through RUS-031: fake Telegram API batch processes a real user flow and persists offsets", async () => {
    const chatId = uniqueChatId("rus-026-031-fake-api");
    const user = await createTelegramUser("rus-026-031-fake-api", chatId);
    const firstTrip = await createDetailedTrip(user.id, "Fake API Longfor trip");
    const firstSession = await createAgentSession(user.id, "completed", firstTrip.id);
    const secondTrip = await createDetailedTrip(user.id, "Fake API selectable trip");
    const secondSession = await createAgentSession(
      user.id,
      "completed",
      secondTrip.id
    );
    const awaitedTrip = await createDetailedTrip(user.id, "Fake API awaited school");
    const awaitedSession = await createAgentSession(
      user.id,
      "completed",
      awaitedTrip.id
    );
    await prisma.trip.updateMany({
      where: { id: { in: [firstTrip.id, secondTrip.id, awaitedTrip.id] } },
      data: { agentSessionId: firstSession.id },
    });
    await prisma.trip.update({
      where: { id: secondTrip.id },
      data: { agentSessionId: secondSession.id },
    });
    await prisma.trip.update({
      where: { id: awaitedTrip.id },
      data: { agentSessionId: awaitedSession.id },
    });

    const updates: TelegramUpdate[] = [
      messageUpdate(chatId, "/start", 26001),
      messageUpdate(chatId, "/new 明天9点到龙湖天街", 26002),
      messageUpdate(chatId, "/status", 26003),
      messageUpdate(chatId, "/trips", 26004),
      callbackUpdate(chatId, "switch-to-second", `sw:${secondTrip.id}`, 26005),
      messageUpdate(chatId, "改成8:45到", 26006),
      messageUpdate(chatId, "/new", 26007),
      messageUpdate(chatId, "明天中午12点半到外事学校", 26008),
      messageUpdate(chatId, "/cancel", 26009),
      messageUpdate(chatId, "/cancel", 26010),
    ];
    const bot = createMockBot();
    bot.getUpdates.mockResolvedValue(updates);
    const bridge = createMockAgentBridge();
    const planningResults = [
      { sessionId: firstSession.id, tripId: firstTrip.id },
      { sessionId: awaitedSession.id, tripId: awaitedTrip.id },
    ];
    bridge.startPlanning.mockImplementation(async (input) => {
      const result = planningResults.shift();
      if (!result) {
        throw new Error("Unexpected extra planning call.");
      }

      await input.progress?.onSessionStarted(result.sessionId);
      await input.progress?.onProgressMessage(`progress: ${input.prompt}`);
      return {
        ...result,
        summary: `planned: ${input.prompt}`,
      };
    });
    bridge.continueSession.mockImplementation(async (input) => {
      await input.progress?.onProgressMessage(`continued: ${input.message}`);
      return {
        sessionId: input.sessionId,
        tripId: secondTrip.id,
        summary: "continued selected trip",
      };
    });

    const processed = await processTelegramPollingBatch({
      bot,
      offset: 26001,
      timeoutSeconds: 1,
      handleUpdate: (update) =>
        handleTelegramUpdate({ update, bot, agentBridge: bridge }),
      markProcessed: markTelegramUpdateProcessed,
    });

    expect(processed).toBe(updates.length);
    expect(bot.getUpdates).toHaveBeenCalledWith({
      offset: 26001,
      timeoutSeconds: 1,
    });
    await expect(getNextTelegramOffset()).resolves.toBe(26011);
    expect(bridge.startPlanning).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: user.id,
        prompt: "明天9点到龙湖天街",
      })
    );
    expect(bridge.startPlanning).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: user.id,
        prompt: "明天中午12点半到外事学校",
      })
    );
    expect(bridge.continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        sessionId: secondSession.id,
        message: "改成8:45到",
      })
    );
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: "switch-to-second",
      text: expect.any(String),
    });
    expect(bot.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ callback_data: `sw:${secondTrip.id}` }),
            ]),
          ]),
        }),
      })
    );
    expect(sentTexts(bot).join("\n")).toContain(firstTrip.id);
    expect(sentTexts(bot).join("\n")).toContain("progress: 明天9点到龙湖天街");
    expect(sentTexts(bot).join("\n")).toContain("continued: 改成8:45到");
    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: awaitedTrip.id } })
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      userId: user.id,
      activeAgentSessionId: null,
      activeTripId: null,
      mode: "idle",
    });
    expect(lastSentText(bot)).toEqual(
      expect.stringContaining("\u6ca1\u6709\u53ef\u53d6\u6d88")
    );
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

function lastSentText(bot: ReturnType<typeof createMockBot>) {
  const calls = bot.sendMessage.mock.calls as unknown as Array<
    Parameters<TelegramBotClient["sendMessage"]>
  >;
  return calls.at(-1)?.[0].text ?? "";
}

function sentTexts(bot: ReturnType<typeof createMockBot>) {
  const calls = bot.sendMessage.mock.calls as unknown as Array<
    Parameters<TelegramBotClient["sendMessage"]>
  >;
  return calls.map((call) => call[0].text);
}

function messageUpdate(
  chatId: string,
  text?: string,
  updateId = Number(Date.now())
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: chatId },
      text,
    },
  };
}

function callbackUpdate(
  chatId: string,
  callbackQueryId: string,
  data: string,
  updateId = Number(Date.now())
): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackQueryId,
      data,
      message: {
        message_id: updateId,
        chat: { id: chatId },
      },
    },
  };
}

function uniqueChatId(label: string) {
  return `${label}-${Date.now()}-${Math.random()}`;
}

async function createTelegramUser(label: string, chatId: string | null) {
  return prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          defaultCity: "Ningbo",
          timezone: "Asia/Shanghai",
          originName: "Home",
          originLngLat: "121.1,29.1",
          routePreference: "balanced",
          telegramChatId: chatId,
        },
      },
    },
    include: { settings: true },
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
      purpose: "telegram_rus_test",
      prompt: "Initial prompt",
    },
  });
}

async function createDetailedTrip(userId: string, title: string) {
  return createPlannedTrip({
    userId,
    rawPrompt: title,
    timezone: "Asia/Shanghai",
    title,
    finalStopName: "Office",
    targetArriveAt: new Date("2026-07-03T01:00:00.000Z"),
    stops: [
      {
        order: 1,
        name: "Office",
        lngLat: "121.2,29.2",
        kind: "destination",
      },
    ],
    legs: [
      {
        order: 1,
        originName: "Home",
        originLngLat: "121.1,29.1",
        destinationName: "Office",
        destinationLngLat: "121.2,29.2",
        routeMinutes: 35,
        bufferMinutes: 7,
        totalMinutes: 42,
        mode: "transit",
        routeTitle: "Airport Express",
        routeRationale: "Fastest deterministic route.",
        segmentTitle: "Airport Express",
        segmentDetail: "Take line 1 for six stops.",
        segmentSource: "amap",
        bufferComponents: [
          {
            category: "venue",
            label: "Reserve entry time",
            minutes: 7,
            reason: "Reserve entry time before arrival.",
          },
        ],
      },
    ],
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
