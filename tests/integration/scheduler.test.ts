import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatClient } from "@/lib/agent/chat-client";
import { createMockAmapClient } from "@/lib/amap/mock";
import { startPlanningSession } from "@/lib/agent/planner";
import { prisma } from "@/lib/db";
import { processDueReminderJobs } from "@/lib/scheduler/process-job";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

const sendTelegramMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notifications/telegram", () => ({
  sendTelegram: sendTelegramMock,
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: sendEmailMock,
}));

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
  "APP_BASE_URL",
] as const;

const savedNotificationEnv = new Map<string, string | undefined>();

describe("scheduler reminder processing", () => {
  const amapClient = createMockAmapClient();

  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    sendTelegramMock.mockReset();
    sendEmailMock.mockReset();
    sendTelegramMock.mockResolvedValue({
      status: "skipped",
      recipient: null,
      error: "缺少 TELEGRAM_BOT_TOKEN",
    });
    sendEmailMock.mockResolvedValue({
      status: "skipped",
      recipient: null,
      error: "缺少 SMTP_HOST",
    });

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

  it("marks stale scheduled jobs skipped without locking, recalculation, or notifications", async () => {
    const now = new Date("2000-01-01T08:30:00.000Z");
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `scheduler-stale-${uniqueId}@example.com`,
        name: "Scheduler Stale User",
        passwordHash: "hash",
        settings: {
          create: {
            originLngLat: "121.5230315924,29.8652491273",
            telegramChatId: `telegram-stale-${uniqueId}`,
            emailRecipient: "scheduler@example.com",
          },
        },
      },
    });
    const trip = await createSchedulerTrip({
      userId: user.id,
      now,
      latestDepartOffsetMinutes: 60,
    });
    const leg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    const staleJob = await prisma.reminderJob.create({
      data: {
        tripId: trip.id,
        legId: leg.id,
        kind: "depart_now",
        scheduledFor: new Date(now.getTime() - 10 * 60_000),
        dedupeKey: `${trip.id}:${leg.id}:depart_now:stale`,
        payloadJson: JSON.stringify({ minutesBeforeDeparture: 0 }),
      },
    });

    const result = await processDueReminderJobs({ now });

    expect(result.processed).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.reminderJob.findUniqueOrThrow({ where: { id: staleJob.id } })
    ).resolves.toMatchObject({
      status: "skipped",
      attempts: 0,
      lockedAt: null,
    });
    await expect(
      prisma.notificationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.recalculationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(0);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("locks due departure jobs, recalculates, logs notifications, and marks skipped without delivery config", async () => {
    const now = new Date("2000-01-01T08:30:00.000Z");
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `scheduler-${uniqueId}@example.com`;

    const user = await prisma.user.create({
      data: {
        email,
        name: "Scheduler User",
        passwordHash: "hash",
        settings: {
          create: {
            originLngLat: "121.5230315924,29.8652491273",
            telegramChatId: `telegram-chat-${uniqueId}`,
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
        kind: "depart_now",
        scheduledFor: now,
        dedupeKey: `${trip.id}:${leg.id}:depart_now:0`,
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

    process.env.APP_BASE_URL = "localhost:3000";
    const resultPromise = processDueReminderJobs({ now });

    await expect(resultPromise).resolves.toMatchObject({
      failed: 0,
    });
    const result = await resultPromise;

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
      `${trip.id}:${leg.id}:email:depart_now:${now.toISOString()}`,
      `${trip.id}:${leg.id}:telegram:depart_now:${now.toISOString()}`,
    ]);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "scheduler@example.com",
        subject: "通勤提醒：该出发了",
        text: expect.stringContaining("该出发了"),
        html: expect.stringContaining("该出发了"),
      })
    );
    expect(sendEmailMock.mock.calls[0][0].html).not.toContain(
      "localhost:3000"
    );

    await processDueReminderJobs({ now });

    await expect(
      prisma.notificationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(2);
  });

  it("runs route rechecks in the same agent session and suppresses notifications within the configured threshold", async () => {
    const now = new Date("2026-07-01T08:30:00.000Z");
    const user = await createSchedulerUser("scheduler-recheck-same-session", {
      routeChangeThresholdMinutes: 3,
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a commute that will be rechecked.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      agentSessionId: session.id,
      rawPrompt: "Plan a commute that will be rechecked.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      targetArriveAt: new Date(now.getTime() + 60 * 60_000),
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
          routeMinutes: 20,
          latestDepartAt: new Date(now.getTime() + 10 * 60_000),
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { tripId: trip.id },
    });
    const recheckJob = await prisma.reminderJob.findFirstOrThrow({
      where: { tripId: trip.id, kind: "recheck", scheduledFor: now },
    });
    let seenMessages = "";
    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        seenMessages = messages.map((message) => message.content).join("\n");
        return {
          message: {
            role: "assistant",
            content: "路线复查完成，当前路线没有明显变化。",
          },
        };
      },
    };

    const result = await processDueReminderJobs({
      now,
      agentOptions: { amapClient, chatClient },
    });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(seenMessages).toContain("Current trip id");
    await expect(
      prisma.agentMessage.findMany({
        where: { agentSessionId: session.id, role: "user" },
        orderBy: { createdAt: "asc" },
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("路线复查"),
        }),
      ])
    );
    await expect(
      prisma.reminderJob.findUniqueOrThrow({ where: { id: recheckJob.id } })
    ).resolves.toMatchObject({ status: "skipped" });
    await expect(
      prisma.notificationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(0);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("notifies and refreshes future reminders when a route recheck changes time beyond the configured threshold", async () => {
    const now = new Date("2026-07-01T08:30:00.000Z");
    const telegramChatId = `telegram-route-change-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    sendTelegramMock.mockResolvedValue({
      status: "sent",
      recipient: telegramChatId,
    });
    sendEmailMock.mockResolvedValue({
      status: "sent",
      recipient: "scheduler@example.com",
    });
    const user = await createSchedulerUser("scheduler-recheck-change", {
      routeChangeThresholdMinutes: 3,
      telegramChatId,
      emailRecipient: "scheduler@example.com",
    });
    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan a commute whose route will change.",
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { status: "completed" },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      agentSessionId: session.id,
      rawPrompt: "Plan a commute whose route will change.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      targetArriveAt: new Date(now.getTime() + 80 * 60_000),
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
          routeMinutes: 25,
          latestDepartAt: new Date(now.getTime() + 30 * 60_000),
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });
    await prisma.agentSession.update({
      where: { id: session.id },
      data: { tripId: trip.id },
    });
    const recheckJob = await prisma.reminderJob.findFirstOrThrow({
      where: { tripId: trip.id, kind: "recheck", scheduledFor: now },
    });
    const changedLatestDepartAt = new Date(now.getTime() + 40 * 60_000);
    let calls = 0;
    const chatClient: AgentChatClient = {
      async complete({ messages }) {
        const toolResults = messages.filter((message) => message.role === "tool");
        calls += 1;

        if (toolResults.length === 0 && calls === 1) {
          return {
            message: {
              role: "assistant",
              content: "复查后路线变慢，更新当前路线。",
              toolCalls: [
                {
                  id: "replace-route-after-recheck",
                  name: "replace_trip_legs",
                  arguments: {
                    tripId: trip.id,
                    title: "Updated Home-Office",
                    finalStopName: "Office",
                    targetArriveAt: new Date(
                      now.getTime() + 85 * 60_000
                    ).toISOString(),
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
                        originName: "Updated Home",
                        originLngLat: "121.1,29.1",
                        destinationName: "Office",
                        destinationLngLat: "121.2,29.2",
                        routeMinutes: 35,
                        bufferMinutes: 5,
                        totalMinutes: 40,
                        latestDepartAt: changedLatestDepartAt.toISOString(),
                        mode: "transit",
                        routeTitle: "Updated transit route",
                        routeRationale: "Traffic is heavier than before.",
                        segmentTitle: "Updated segment",
                        segmentDetail: "Generated by route recheck.",
                        bufferComponents: [
                          {
                            category: "transfer",
                            label: "Transfer",
                            minutes: 5,
                            reason: "Leave time for transfer.",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          };
        }

        return {
          message: {
            role: "assistant",
            content: "已根据复查结果更新路线。",
          },
        };
      },
    };

    const result = await processDueReminderJobs({
      now,
      agentOptions: { amapClient, chatClient },
    });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.reminderJob.findUniqueOrThrow({ where: { id: recheckJob.id } })
    ).resolves.toMatchObject({ status: "sent" });
    const refreshedReminders = await prisma.reminderJob.findMany({
      where: { tripId: trip.id, status: "scheduled" },
      orderBy: { scheduledFor: "asc" },
    });
    expect(refreshedReminders.map((job) => job.scheduledFor.toISOString())).toEqual([
      new Date(changedLatestDepartAt.getTime() - 30 * 60_000).toISOString(),
      new Date(changedLatestDepartAt.getTime() - 20 * 60_000).toISOString(),
      new Date(changedLatestDepartAt.getTime() - 15 * 60_000).toISOString(),
      new Date(changedLatestDepartAt.getTime() - 10 * 60_000).toISOString(),
      new Date(changedLatestDepartAt.getTime() - 5 * 60_000).toISOString(),
      changedLatestDepartAt.toISOString(),
    ]);
    expect(sendTelegramMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: telegramChatId,
        text: expect.stringContaining("时间已变化"),
      })
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "scheduler@example.com",
        subject: "通勤时间已变化：Updated Home-Office",
        text: expect.stringContaining("出发时间已更新"),
        html: expect.stringContaining("出发时间已更新"),
      })
    );
    const routeChangeEmail = sendEmailMock.mock.calls[0][0];
    expect(routeChangeEmail.text).toContain("17:55");
    expect(routeChangeEmail.html).toContain("17:55");
    expect(routeChangeEmail.text).toContain("Updated transit route");
    expect(routeChangeEmail.text).toContain("40 分钟");
    expect(routeChangeEmail.html).toContain("Updated transit route");
    expect(routeChangeEmail.html).toContain("40 分钟");
    expect(routeChangeEmail.html).toContain("原最晚出发时间");
    expect(routeChangeEmail.html).toContain("17:00");
  });
});

async function createSchedulerUser(
  label: string,
  settings: {
    routeChangeThresholdMinutes?: number;
    telegramChatId?: string;
    emailRecipient?: string;
  } = {}
) {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${label}-${uniqueId}@example.com`,
      name: label,
      passwordHash: "hash",
      settings: {
        create: {
          originName: "Home",
          originLngLat: "121.1,29.1",
          telegramChatId:
            settings.telegramChatId ?? `telegram-${label}-${uniqueId}`,
          emailRecipient: settings.emailRecipient ?? "scheduler@example.com",
          routeChangeThresholdMinutes:
            settings.routeChangeThresholdMinutes ?? 3,
        },
      },
    },
  });
}

async function createSchedulerTrip(input: {
  userId: string;
  now: Date;
  latestDepartOffsetMinutes: number;
}) {
  return createPlannedTrip({
    userId: input.userId,
    rawPrompt: "Arrive at office.",
    timezone: "Asia/Shanghai",
    title: "Home-Office",
    finalStopName: "Office",
    targetArriveAt: new Date(input.now.getTime() + 60 * 60_000),
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
        routeMinutes: 20,
        latestDepartAt: new Date(
          input.now.getTime() + input.latestDepartOffsetMinutes * 60_000
        ),
        bufferComponents: [
          {
            category: "transfer",
            label: "Transfer",
            minutes: 5,
            reason: "Leave time for transfer.",
          },
        ],
      },
    ],
  });
}
