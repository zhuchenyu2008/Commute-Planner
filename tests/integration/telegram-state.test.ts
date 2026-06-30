import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  findBoundTelegramUser,
  getNextTelegramOffset,
  listSwitchableTrips,
  markTelegramUpdateProcessed,
  setTelegramAwaitingNewPrompt,
  switchTelegramActiveTrip,
} from "@/lib/telegram/state";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

describe("telegram state service", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("resolves unbound, bound, and ambiguous chat ids", async () => {
    const chatId = `chat-${Date.now()}`;
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "unbound",
      chatId,
    });

    const user = await createTelegramUser("bound", chatId);
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "bound",
      chatId,
      user: { id: user.id },
    });

    await createTelegramUser("ambiguous", chatId);
    await expect(findBoundTelegramUser(chatId)).resolves.toMatchObject({
      status: "ambiguous",
      chatId,
    });
  });

  it("stores awaiting new prompt state", async () => {
    const chatId = `awaiting-${Date.now()}`;
    const user = await createTelegramUser("awaiting", chatId);

    const state = await setTelegramAwaitingNewPrompt({ chatId, userId: user.id });

    expect(state).toMatchObject({
      chatId,
      userId: user.id,
      mode: "awaiting_new_prompt",
      activeAgentSessionId: null,
      activeTripId: null,
    });
  });

  it("lists monitoring trips first, then newest trips, with a maximum of 10", async () => {
    const chatId = `trips-${Date.now()}`;
    const user = await createTelegramUser("trips", chatId);
    const monitoring = await createTrip(user.id, "home-monitoring", "monitoring");
    await markReminderJobsDone(monitoring.id, 2);
    await createTrip(user.id, "home-cancelled", "cancelled");

    const planningTrips = [];
    for (let index = 0; index < 25; index += 1) {
      planningTrips.push(
        await createTrip(user.id, `home-planning-${index}`, "planning")
      );
    }

    const trips = await listSwitchableTrips({ userId: user.id });
    const newestPlanningIds = planningTrips
      .slice()
      .reverse()
      .slice(0, 9)
      .map((trip) => trip.id);

    expect(trips).toHaveLength(10);
    expect(trips.map((trip) => trip.id)).toEqual([
      monitoring.id,
      ...newestPlanningIds,
    ]);
    expect(trips[0]).toMatchObject({
      title: "home-monitoring",
      scheduledReminderCount: 4,
    });
  });

  it("switches active trip and bootstraps a completed agent session when needed", async () => {
    const chatId = `switch-${Date.now()}`;
    const user = await createTelegramUser("switch", chatId);
    const trip = await createTrip(user.id, "home-library", "monitoring");

    const result = await switchTelegramActiveTrip({
      chatId,
      userId: user.id,
      tripId: trip.id,
    });

    expect(result).toMatchObject({
      status: "switched",
      trip: { id: trip.id, title: "home-library" },
      agentSessionId: expect.any(String),
    });
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeTripId: trip.id,
      activeAgentSessionId: result.agentSessionId,
      mode: "active",
    });
    await expect(
      prisma.agentSession.findUniqueOrThrow({
        where: { id: result.agentSessionId },
        include: { messages: true },
      })
    ).resolves.toMatchObject({
      status: "completed",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
      ]),
    });
  });

  it("rejects trips that are cancelled or owned by another user", async () => {
    const chatId = `reject-${Date.now()}`;
    const user = await createTelegramUser("reject", chatId);
    const otherUser = await createTelegramUser("reject-other", `${chatId}-other`);
    const otherTrip = await createTrip(
      otherUser.id,
      "other-user-trip",
      "monitoring"
    );
    const cancelledTrip = await createTrip(user.id, "home-cancelled", "cancelled");

    await expect(
      switchTelegramActiveTrip({
        chatId,
        userId: user.id,
        tripId: otherTrip.id,
      })
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      switchTelegramActiveTrip({
        chatId,
        userId: user.id,
        tripId: cancelledTrip.id,
      })
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      prisma.telegramChatState.findUnique({ where: { chatId } })
    ).resolves.toBeNull();
  });

  it("ignores a trip agent session scalar that points at another trip", async () => {
    const chatId = `stale-session-${Date.now()}`;
    const user = await createTelegramUser("stale-session", chatId);
    const otherTrip = await createTrip(user.id, "home-old-trip", "monitoring");
    const trip = await createTrip(user.id, "home-current-trip", "monitoring");
    const otherSession = await prisma.agentSession.create({
      data: {
        userId: user.id,
        tripId: otherTrip.id,
        status: "completed",
        purpose: "telegram_continuation",
        prompt: "Existing session for a different trip.",
      },
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { agentSessionId: otherSession.id },
    });

    const result = await switchTelegramActiveTrip({
      chatId,
      userId: user.id,
      tripId: trip.id,
    });

    expect(result).toMatchObject({
      status: "switched",
      agentSessionId: expect.any(String),
    });
    expect(result.agentSessionId).not.toBe(otherSession.id);
    await expect(
      prisma.telegramChatState.findUniqueOrThrow({ where: { chatId } })
    ).resolves.toMatchObject({
      activeTripId: trip.id,
      activeAgentSessionId: result.agentSessionId,
    });
    await expect(
      prisma.agentSession.findUniqueOrThrow({
        where: { id: result.agentSessionId },
      })
    ).resolves.toMatchObject({
      tripId: trip.id,
      status: "completed",
    });
  });

  it("stores and returns the next Telegram offset", async () => {
    const defaultState = await prisma.telegramBotState.findUnique({
      where: { id: "default" },
    });
    if (defaultState) {
      await prisma.telegramBotState.delete({ where: { id: "default" } });
    }

    await expect(getNextTelegramOffset()).resolves.toBeUndefined();
    await markTelegramUpdateProcessed(42);
    await expect(getNextTelegramOffset()).resolves.toBe(43);
    await markTelegramUpdateProcessed(41);
    await expect(getNextTelegramOffset()).resolves.toBe(43);
  });
});

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
  const destination = title.split("-").at(-1) ?? title;
  const trip = await createPlannedTrip({
    userId,
    rawPrompt: title,
    timezone: "Asia/Shanghai",
    title,
    finalStopName: destination,
    targetArriveAt: new Date("2026-07-01T01:00:00.000Z"),
    stops: [{ order: 1, name: destination }],
    legs: [
      {
        order: 1,
        originName: "home",
        originLngLat: "121.1,29.1",
        destinationName: destination,
        destinationLngLat: "121.2,29.2",
        routeMinutes: 20,
        bufferComponents: [
          {
            category: "transfer",
            label: "transfer",
            minutes: 5,
            reason: "Reserve time for transfer.",
          },
        ],
      },
    ],
  });

  return prisma.trip.update({ where: { id: trip.id }, data: { status } });
}

async function markReminderJobsDone(tripId: string, count: number) {
  const reminderJobs = await prisma.reminderJob.findMany({
    where: { tripId, status: "scheduled" },
    orderBy: { scheduledFor: "asc" },
    take: count,
    select: { id: true },
  });

  await prisma.reminderJob.updateMany({
    where: { id: { in: reminderJobs.map((job) => job.id) } },
    data: { status: "sent" },
  });
}
