import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST as cancelMonitoringPost } from "@app/api/trips/[tripId]/cancel-monitoring/route";
import { prisma } from "@/lib/db";
import { processDueReminderJobs } from "@/lib/scheduler/process-job";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const sendTelegramMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/notifications/telegram", () => ({
  sendTelegram: sendTelegramMock,
}));

vi.mock("@/lib/notifications/email", () => ({
  sendEmail: sendEmailMock,
}));

describe("Batch A real-user scheduler scenarios", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    getCurrentUserMock.mockReset();
    sendTelegramMock.mockReset();
    sendEmailMock.mockReset();
    sendTelegramMock.mockResolvedValue({
      status: "skipped",
      recipient: null,
      error: "mocked Telegram delivery",
    });
    sendEmailMock.mockResolvedValue({
      status: "skipped",
      recipient: null,
      error: "mocked email delivery",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("RUS-016 cancels monitoring from trip detail and prevents due reminders from firing", async () => {
    const now = new Date("2026-07-02T00:30:00.000Z");
    const user = await createBatchAUser("rus-016");
    const trip = await createBatchATrip({
      userId: user.id,
      now,
      latestDepartOffsetMinutes: 30,
    });
    getCurrentUserMock.mockResolvedValue({ id: user.id });

    const response = await cancelMonitoringPost(
      new Request(
        `http://localhost/api/trips/${trip.id}/cancel-monitoring`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ tripId: trip.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "cancelled" });

    await expect(
      prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      prisma.tripLeg.findMany({ where: { tripId: trip.id } })
    ).resolves.toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
    await expect(
      prisma.reminderJob.count({
        where: { tripId: trip.id, status: "scheduled" },
      })
    ).resolves.toBe(0);

    const tickResult = await processDueReminderJobs({ now });

    expect(tickResult.sent).toBe(0);
    expect(tickResult.failed).toBe(0);
    await expect(
      prisma.notificationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.recalculationLog.count({ where: { tripId: trip.id } })
    ).resolves.toBe(0);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("RUS-034 does not resend duplicate-looking due reminders with the same notification dedupe key", async () => {
    const now = new Date("2026-07-02T01:00:00.000Z");
    const recipientSuffix = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const telegramChatId = `telegram-rus-034-${recipientSuffix}`;
    const emailRecipient = `rus-034-${recipientSuffix}@example.com`;
    const user = await createBatchAUser("rus-034", {
      telegramChatId,
      emailRecipient,
    });
    const trip = await createBatchATrip({
      userId: user.id,
      now,
      latestDepartOffsetMinutes: 60,
    });
    const leg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id },
    });
    await prisma.reminderJob.deleteMany({ where: { tripId: trip.id } });
    await prisma.reminderJob.createMany({
      data: [
        {
          tripId: trip.id,
          legId: leg.id,
          kind: "depart_now",
          scheduledFor: now,
          dedupeKey: `${trip.id}:${leg.id}:depart-now-primary`,
          payloadJson: JSON.stringify({ source: "primary" }),
        },
        {
          tripId: trip.id,
          legId: leg.id,
          kind: "depart_now",
          scheduledFor: now,
          dedupeKey: `${trip.id}:${leg.id}:depart-now-duplicate`,
          payloadJson: JSON.stringify({ source: "duplicate" }),
        },
      ],
    });
    sendTelegramMock.mockResolvedValue({
      status: "sent",
      recipient: telegramChatId,
    });
    sendEmailMock.mockResolvedValue({
      status: "sent",
      recipient: emailRecipient,
    });

    const firstTick = await processDueReminderJobs({ now });
    const secondTick = await processDueReminderJobs({ now });

    expect(firstTick.processed).toBe(2);
    expect(firstTick.sent).toBe(2);
    expect(secondTick.processed).toBe(0);
    expect(secondTick.sent).toBe(0);
    await expect(
      prisma.notificationLog.findMany({
        where: { tripId: trip.id },
        orderBy: { channel: "asc" },
      })
    ).resolves.toEqual([
      expect.objectContaining({
        channel: "email",
        dedupeKey: `${trip.id}:${leg.id}:email:depart_now:${now.toISOString()}`,
      }),
      expect.objectContaining({
        channel: "telegram",
        dedupeKey: `${trip.id}:${leg.id}:telegram:depart_now:${now.toISOString()}`,
      }),
    ]);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMock).toHaveBeenCalledTimes(1);
  });
});

async function createBatchAUser(
  label: string,
  settings: {
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
          emailRecipient: settings.emailRecipient ?? `${label}@example.com`,
        },
      },
    },
  });
}

async function createBatchATrip(input: {
  userId: string;
  now: Date;
  latestDepartOffsetMinutes: number;
}) {
  return createPlannedTrip({
    userId: input.userId,
    rawPrompt: "Plan a monitored commute.",
    timezone: "Asia/Shanghai",
    title: "Home-Office",
    finalStopName: "Office",
    targetArriveAt: new Date(input.now.getTime() + 90 * 60_000),
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
