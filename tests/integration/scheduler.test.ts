import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processDueReminderJobs } from "@/lib/scheduler/process-job";
import { ensureTestDatabase } from "./test-db";

const notificationEnvKeys = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_PORT",
  "SMTP_SECURE",
  "EMAIL_RECIPIENT",
] as const;

const savedNotificationEnv = new Map<string, string | undefined>();

describe("scheduler reminder processing", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    savedNotificationEnv.clear();
    for (const key of notificationEnvKeys) {
      savedNotificationEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of notificationEnvKeys) {
      const value = savedNotificationEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("locks due jobs, recalculates, logs notifications, and marks skipped without delivery config", async () => {
    const earliestScheduled = await prisma.reminderJob.findFirst({
      where: { status: "scheduled" },
      orderBy: { scheduledFor: "asc" },
      select: { scheduledFor: true },
    });
    const now = earliestScheduled
      ? new Date(earliestScheduled.scheduledFor.getTime() - 60_000)
      : new Date("2026-07-01T08:30:00.000Z");
    const email = `scheduler-${Date.now()}@example.com`;

    const user = await prisma.user.create({
      data: {
        email,
        name: "Scheduler User",
        passwordHash: "hash",
        settings: {
          create: {
            originLngLat: "121.5230315924,29.8652491273",
            telegramChatId: "telegram-chat-1",
            emailRecipient: "scheduler@example.com",
          },
        },
      },
    });

    const trip = await prisma.trip.create({
      data: {
        userId: user.id,
        title: "Morning commute",
        rawPrompt: "Arrive at office by 10.",
        timezone: "Asia/Shanghai",
        status: "monitoring",
        stops: {
          create: {
            order: 0,
            name: "Office",
            lngLat: "121.520000,31.220000",
          },
        },
      },
      include: { stops: true },
    });

    const leg = await prisma.tripLeg.create({
      data: {
        tripId: trip.id,
        order: 0,
        toStopId: trip.stops[0].id,
        originName: "Home",
        originLngLat: "121.5230315924,29.8652491273",
        destinationName: "Office",
        destinationLngLat: "121.520000,31.220000",
        latestDepartAt: new Date(now.getTime() + 30 * 60_000),
        status: "monitoring",
      },
    });

    const dueJob = await prisma.reminderJob.create({
      data: {
        tripId: trip.id,
        legId: leg.id,
        kind: "recheck",
        scheduledFor: now,
        dedupeKey: `${trip.id}:${leg.id}:recheck:30`,
        payloadJson: JSON.stringify({ minutesBeforeDeparture: 30 }),
      },
    });

    await prisma.reminderJob.create({
      data: {
        tripId: trip.id,
        legId: leg.id,
        kind: "recheck",
        scheduledFor: new Date(now.getTime() + 10 * 60_000),
        dedupeKey: `${trip.id}:${leg.id}:recheck:20`,
        payloadJson: JSON.stringify({ minutesBeforeDeparture: 20 }),
      },
    });

    const result = await processDueReminderJobs({ now });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);

    const processedJob = await prisma.reminderJob.findUniqueOrThrow({
      where: { id: dueJob.id },
    });
    expect(processedJob.status).toBe("skipped");
    expect(processedJob.attempts).toBe(1);
    expect(processedJob.lockedAt?.toISOString()).toBe(now.toISOString());

    const recalculations = await prisma.recalculationLog.findMany({
      where: { tripId: trip.id, legId: leg.id },
    });
    expect(recalculations).toHaveLength(1);
    expect(recalculations[0]).toMatchObject({
      trigger: "reminder",
      status: "skipped",
    });
    expect(recalculations[0].summary).toContain("智能体辅助复算");

    const notifications = await prisma.notificationLog.findMany({
      where: { tripId: trip.id, legId: leg.id },
      orderBy: { channel: "asc" },
    });
    expect(notifications.map((log) => log.channel)).toEqual([
      "email",
      "telegram",
    ]);
    expect(notifications.map((log) => log.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(notifications.map((log) => log.dedupeKey)).toEqual([
      `${trip.id}:${leg.id}:email:recheck:${now.toISOString()}`,
      `${trip.id}:${leg.id}:telegram:recheck:${now.toISOString()}`,
    ]);

    await processDueReminderJobs({ now });

    await expect(
      prisma.notificationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(2);
  });
});
