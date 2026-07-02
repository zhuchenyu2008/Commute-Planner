import { expect, test } from "@playwright/test";
import type { prisma as PrismaInstance } from "../../src/lib/db";
import { createPlannedTrip } from "../../src/lib/trips/create-trip";
import { ensureTestDatabase } from "../integration/test-db";

const runRealApiScenario = process.env.RUS_015_REAL_API === "1";
const email = "rus-015-real@example.com";
const schedulerSecret = process.env.SCHEDULER_TICK_SECRET ?? "rus-015-secret";
const configuredTelegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();
const emailRecipient =
  process.env.EMAIL_RECIPIENT?.trim() ||
  process.env.SMTP_USER?.trim() ||
  "rus-015-real@example.com";
const now = new Date();
const targetArriveAt = new Date(now.getTime() + 45 * 60_000);
const latestDepartAt = new Date(now.getTime() - 1_000);

process.env.DATABASE_URL ??= "file:./e2e-test.db";
test.setTimeout(Number(process.env.RUS_015_TIMEOUT_MS ?? 300_000));
test.skip(
  !runRealApiScenario,
  "Set RUS_015_REAL_API=1 and run against a real API service to execute this scenario."
);

let prisma: typeof PrismaInstance;
let tripId: string;
let departNowJobId: string;
let telegramChatId: string;

function resolveExpectedStatus(statuses: string[]) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("sent")) return "sent";
  return "skipped";
}

test.beforeAll(async () => {
  const db = await import("../../src/lib/db");
  prisma = db.prisma;

  await ensureTestDatabase();
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "RUS-015 Real API User",
      passwordHash: "hash",
    },
    update: {
      name: "RUS-015 Real API User",
    },
  });

  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.agentSession.deleteMany({ where: { userId: user.id } });
  await prisma.trip.deleteMany({ where: { userId: user.id } });

  telegramChatId =
    configuredTelegramChatId || `telegram-rus-015-real-${Date.now()}`;
  await prisma.userSettings.updateMany({
    where: {
      telegramChatId,
      userId: { not: user.id },
    },
    data: { telegramChatId: null },
  });
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      defaultCity: "Ningbo",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      telegramChatId,
      emailRecipient,
    },
    update: {
      defaultCity: "Ningbo",
      timezone: "Asia/Shanghai",
      originName: "E2E Origin",
      originLngLat: "121.5230315924,29.8652491273",
      telegramChatId,
      emailRecipient,
    },
  });

  const trip = await createPlannedTrip({
    userId: user.id,
    rawPrompt: "RUS-015 departure reminder real service test.",
    timezone: "Asia/Shanghai",
    title: "E2E Origin to Office",
    finalStopName: "Office",
    targetArriveAt,
    stops: [
      {
        order: 1,
        name: "Office",
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
        destinationName: "Office",
        destinationLngLat: "121.590931,29.879859",
        targetArriveAt,
        routeMinutes: 35,
        bufferMinutes: 10,
        totalMinutes: 45,
        latestDepartAt,
        mode: "transit",
        routeTitle: "Seeded real departure route",
        routeRationale: "Seeded data for scheduler departure reminder.",
        segmentTitle: "Seeded segment",
        segmentDetail: "Seeded real departure reminder route.",
        bufferComponents: [
          {
            category: "transfer",
            label: "Transfer buffer",
            minutes: 10,
            reason: "Seeded buffer for departure reminder.",
          },
        ],
      },
    ],
  });
  tripId = trip.id;

  const leg = await prisma.tripLeg.findFirstOrThrow({
    where: { tripId: trip.id, order: 1 },
  });
  const departNowJob = await prisma.reminderJob.findFirstOrThrow({
    where: { tripId: trip.id, legId: leg.id, kind: "depart_now" },
  });
  departNowJobId = departNowJob.id;
  await prisma.reminderJob.update({
    where: { id: departNowJob.id },
    data: { scheduledFor: latestDepartAt },
  });
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("RUS-015 processes a due departure reminder through the authorized scheduler tick and dedupes duplicate ticks", async ({
  request,
}) => {
  const response = await request.post("/api/scheduler/tick", {
    headers: { authorization: `Bearer ${schedulerSecret}` },
    timeout: Number(process.env.RUS_015_TICK_TIMEOUT_MS ?? 180_000),
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    processed: number;
    sent: number;
    skipped: number;
    failed: number;
  };
  expect(body.processed).toBeGreaterThanOrEqual(1);

  const notifications = await prisma.notificationLog.findMany({
    where: { tripId, dedupeKey: { contains: ":depart_now:" } },
    orderBy: { channel: "asc" },
  });
  expect(notifications.map((notification) => notification.channel)).toEqual([
    "email",
    "telegram",
  ]);
  expect(
    notifications.every((notification) =>
      ["sent", "skipped", "failed"].includes(notification.status)
    )
  ).toBe(true);
  expect(
    notifications.every((notification) =>
      notification.content.includes("Office")
    )
  ).toBe(true);

  const expectedJobStatus = resolveExpectedStatus(
    notifications.map((notification) => notification.status)
  );
  const processedJob = await prisma.reminderJob.findUniqueOrThrow({
    where: { id: departNowJobId },
  });
  expect(processedJob.status).toBe(expectedJobStatus);
  expect(processedJob.attempts).toBe(1);
  expect(processedJob.lockedAt).toBeTruthy();

  const recalculation = await prisma.recalculationLog.findFirstOrThrow({
    where: { tripId, trigger: "reminder" },
  });
  expect(recalculation.status).toBe(expectedJobStatus);

  const telegramNotification = notifications.find(
    (notification) => notification.channel === "telegram"
  );
  expect(telegramNotification).toBeTruthy();
  if (configuredTelegramChatId) {
    expect(telegramNotification?.status).toBe("sent");
  } else if (telegramNotification?.status === "failed") {
    expect(telegramNotification.error ?? "").not.toMatch(/fetch failed/i);
  }

  const secondResponse = await request.post("/api/scheduler/tick", {
    headers: { authorization: `Bearer ${schedulerSecret}` },
    timeout: Number(process.env.RUS_015_TICK_TIMEOUT_MS ?? 180_000),
  });
  expect(secondResponse.status()).toBe(200);

  await expect(
    prisma.notificationLog.count({
      where: { tripId, dedupeKey: { contains: ":depart_now:" } },
    })
  ).resolves.toBe(2);
  await expect(
    prisma.reminderJob.findUniqueOrThrow({ where: { id: departNowJobId } })
  ).resolves.toMatchObject({
    attempts: 1,
    status: expectedJobStatus,
  });
});
