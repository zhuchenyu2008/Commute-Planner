import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { createPlannedTrip } from "../../src/lib/trips/create-trip";
import { ensureTestDatabase } from "../integration/test-db";

const runRealApiScenario = process.env.RUS_014_REAL_API === "1";
const email = "rus-014-real@example.com";
const schedulerSecret = process.env.SCHEDULER_TICK_SECRET ?? "rus-014-secret";
const configuredTelegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();
const targetArriveAt = new Date("2026-07-03T01:00:00.000Z");
const staleLatestDepartAt = new Date("2026-07-03T00:59:00.000Z");
process.env.DATABASE_URL ??= "file:./e2e-test.db";
test.setTimeout(Number(process.env.RUS_014_TIMEOUT_MS ?? 600_000));
test.skip(
  !runRealApiScenario,
  "Set RUS_014_REAL_API=1 and run against a real API service to execute this scenario."
);

let prisma: typeof PrismaInstance;
let userId: string;
let tripId: string;
let sessionId: string;
let dueRecheckJobId: string;
let telegramChatId: string;

test.beforeAll(async () => {
  const db = await import("../../src/lib/db");
  prisma = db.prisma;

  await ensureTestDatabase();
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "RUS-014 Real API User",
      passwordHash: "hash",
    },
    update: {
      name: "RUS-014 Real API User",
    },
  });
  userId = user.id;

  await prisma.session.deleteMany({ where: { userId } });
  await prisma.agentSession.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  telegramChatId =
    configuredTelegramChatId || `telegram-rus-014-real-${Date.now()}`;
  await prisma.userSettings.updateMany({
    where: {
      telegramChatId,
      userId: { not: userId },
    },
    data: { telegramChatId: null },
  });
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      defaultCity: "宁波",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      routeChangeThresholdMinutes: 3,
      telegramChatId,
      emailRecipient: "rus-014-real@example.com",
    },
    update: {
      defaultCity: "宁波",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      routeChangeThresholdMinutes: 3,
      telegramChatId,
      emailRecipient: "rus-014-real@example.com",
    },
  });

  const session = await prisma.agentSession.create({
    data: {
      userId,
      status: "completed",
      prompt:
        "2026-07-03 09:00 arrive at Longhu Tianjie; scheduler should recheck this route.",
    },
  });
  sessionId = session.id;

  const trip = await createPlannedTrip({
    userId,
    agentSessionId: session.id,
    rawPrompt:
      "2026-07-03 09:00 arrive at Longhu Tianjie; scheduler should recheck this route.",
    timezone: "Asia/Shanghai",
    title: "E2E Origin to Longhu Tianjie",
    finalStopName: "龙湖宁波鄞州天街",
    targetArriveAt,
    stops: [
      {
        order: 1,
        name: "龙湖宁波鄞州天街",
        lngLat: "121.590931,29.879859",
        kind: "destination",
        targetArriveAt,
      },
    ],
    legs: [
      {
        order: 1,
        originName: "E2E Origin",
        originLngLat: "121.5230315924,29.8652491273",
        destinationName: "龙湖宁波鄞州天街",
        destinationLngLat: "121.590931,29.879859",
        targetArriveAt,
        routeMinutes: 1,
        bufferMinutes: 0,
        totalMinutes: 1,
        latestDepartAt: staleLatestDepartAt,
        mode: "transit",
        routeTitle: "Unrealistically short stale route",
        routeRationale: "Seeded stale route for real scheduler recheck.",
        segmentTitle: "Stale segment",
        segmentDetail: "Seeded with an unrealistically short duration.",
        bufferComponents: [
          {
            category: "transfer",
            label: "No buffer",
            minutes: 0,
            reason: "Seeded stale data.",
          },
        ],
      },
    ],
  });
  tripId = trip.id;
  await prisma.agentSession.update({
    where: { id: session.id },
    data: { tripId: trip.id },
  });

  const leg = await prisma.tripLeg.findFirstOrThrow({
    where: { tripId: trip.id },
  });
  const recheckJob = await prisma.reminderJob.findFirstOrThrow({
    where: { tripId: trip.id, legId: leg.id, kind: "recheck" },
    orderBy: { scheduledFor: "asc" },
  });
  dueRecheckJobId = recheckJob.id;
  await prisma.reminderJob.update({
    where: { id: recheckJob.id },
    data: { scheduledFor: new Date(Date.now() - 1_000) },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-014 uses real AI and AMap during scheduler recheck, updates route, and logs route-change notifications", async ({
  request,
}) => {
  const response = await request.post("/api/scheduler/tick", {
    headers: { authorization: `Bearer ${schedulerSecret}` },
    timeout: Number(process.env.RUS_014_TICK_TIMEOUT_MS ?? 300_000),
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    processed: number;
  };
  expect(body.processed).toBeGreaterThanOrEqual(1);

  const toolCalls = await prisma.agentToolCall.findMany({
    where: { agentSessionId: sessionId },
    orderBy: { createdAt: "asc" },
  });
  const toolCallNames = toolCalls.map((toolCall) => toolCall.name);
  expect(toolCallNames).toContain("read_current_trip");
  expect(
    toolCallNames.some((name) =>
      ["get_transit_route", "get_walking_route", "get_bicycling_route"].includes(
        name
      )
    )
  ).toBe(true);
  expect(
    toolCallNames.some((name) =>
      ["replace_trip_legs", "replace_trip_stops"].includes(name)
    )
  ).toBe(true);

  const processedRecheck = await prisma.reminderJob.findUniqueOrThrow({
    where: { id: dueRecheckJobId },
  });
  expect(["sent", "skipped", "failed"]).toContain(processedRecheck.status);
  expect(processedRecheck.attempts).toBe(1);

  const updatedLeg = await prisma.tripLeg.findFirstOrThrow({
    where: { tripId, order: 1 },
    include: { selectedCandidate: true },
  });
  expect(updatedLeg.latestDepartAt?.getTime()).toBeLessThan(
    staleLatestDepartAt.getTime() - 3 * 60_000
  );
  expect(updatedLeg.selectedCandidate?.totalMinutes).toBeGreaterThan(3);

  const recalculation = await prisma.recalculationLog.findFirstOrThrow({
    where: { tripId, trigger: "recheck" },
  });
  expect(["sent", "skipped", "failed"]).toContain(recalculation.status);
  expect(recalculation.summary).toContain("已更新");

  const refreshedReminders = await prisma.reminderJob.findMany({
    where: { tripId, status: "scheduled" },
    orderBy: { scheduledFor: "asc" },
  });
  expect(refreshedReminders).toHaveLength(6);
  expect(
    refreshedReminders.every((reminder) => reminder.legId === updatedLeg.id)
  ).toBe(true);

  const routeChangeNotifications = await prisma.notificationLog.findMany({
    where: { tripId, dedupeKey: { contains: ":route_change:" } },
    orderBy: { channel: "asc" },
  });
  expect(routeChangeNotifications.length).toBeGreaterThanOrEqual(1);
  expect(
    routeChangeNotifications.every((notification) =>
      ["sent", "skipped", "failed"].includes(notification.status)
    )
  ).toBe(true);
  const latestDepartTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  }).format(updatedLeg.latestDepartAt!);
  expect(
    routeChangeNotifications.some((notification) =>
      notification.content.includes(latestDepartTime)
    )
  ).toBe(true);
  const telegramNotification = routeChangeNotifications.find(
    (notification) => notification.channel === "telegram"
  );
  expect(telegramNotification).toBeTruthy();
  if (configuredTelegramChatId) {
    expect(telegramNotification?.status).toBe("sent");
  } else {
    expect(telegramNotification?.status).toBe("failed");
    expect(telegramNotification?.error ?? "").not.toMatch(/fetch failed/i);
  }
});
