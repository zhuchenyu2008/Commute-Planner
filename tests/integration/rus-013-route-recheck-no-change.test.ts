import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@app/api/scheduler/tick/route";
import { runAcceptedContinuationSession } from "@/lib/agent/planner";
import { prisma } from "@/lib/db";
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

vi.mock("@/lib/agent/planner", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent/planner")>(
      "@/lib/agent/planner"
    );

  return {
    ...actual,
    runAcceptedContinuationSession: vi.fn(async (sessionId: string) => {
      const db = await import("@/lib/db");
      const session = await db.prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status: "completed",
          messages: {
            create: {
              role: "assistant",
              content: "Route recheck completed without a significant change.",
            },
          },
        },
      });

      return {
        sessionId,
        status: "completed" as const,
        tripId: session.tripId,
      };
    }),
  };
});

describe("RUS-013 route recheck without significant change", () => {
  const secret = "rus-013-secret";
  let savedSchedulerSecret: string | undefined;

  beforeAll(async () => {
    await ensureTestDatabase();
  });

  beforeEach(() => {
    savedSchedulerSecret = process.env.SCHEDULER_TICK_SECRET;
    process.env.SCHEDULER_TICK_SECRET = secret;
    sendTelegramMock.mockReset();
    sendEmailMock.mockReset();
    vi.mocked(runAcceptedContinuationSession).mockClear();
  });

  afterEach(() => {
    if (savedSchedulerSecret === undefined) {
      delete process.env.SCHEDULER_TICK_SECRET;
    } else {
      process.env.SCHEDULER_TICK_SECRET = savedSchedulerSecret;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("processes an authorized due recheck, skips recalculation, and sends no notification", async () => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `rus-013-${uniqueId}@example.com`,
        name: "RUS-013 User",
        passwordHash: "hash",
        settings: {
          create: {
            originName: "Home",
            originLngLat: "121.1,29.1",
            routeChangeThresholdMinutes: 3,
          },
        },
      },
    });
    const session = await prisma.agentSession.create({
      data: {
        userId: user.id,
        status: "completed",
        prompt: "Plan a commute that will be rechecked.",
      },
    });
    const latestDepartAt = new Date(Date.now() + 30 * 60_000);
    const trip = await createPlannedTrip({
      userId: user.id,
      agentSessionId: session.id,
      rawPrompt: "Plan a commute that will be rechecked.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      targetArriveAt: new Date(latestDepartAt.getTime() + 30 * 60_000),
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
          bufferMinutes: 10,
          totalMinutes: 30,
          latestDepartAt,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 10,
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

    const leg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id },
      include: { selectedCandidate: true },
    });
    const recheckJob = await prisma.reminderJob.findFirstOrThrow({
      where: { tripId: trip.id, legId: leg.id, kind: "recheck" },
      orderBy: { scheduledFor: "asc" },
    });
    await prisma.reminderJob.update({
      where: { id: recheckJob.id },
      data: { scheduledFor: new Date(Date.now() - 1_000) },
    });
    const futureRemindersBefore = await prisma.reminderJob.findMany({
      where: {
        tripId: trip.id,
        status: "scheduled",
        id: { not: recheckJob.id },
      },
      orderBy: { scheduledFor: "asc" },
    });

    const response = await POST(
      new Request("http://localhost/api/scheduler/tick", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      processed: number;
      skipped: number;
      sent: number;
      failed: number;
    };
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.skipped).toBeGreaterThanOrEqual(1);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
    expect(runAcceptedContinuationSession).toHaveBeenCalledWith(
      session.id,
      undefined
    );

    const processedRecheck = await prisma.reminderJob.findUniqueOrThrow({
      where: { id: recheckJob.id },
    });
    expect(processedRecheck.status).toBe("skipped");
    expect(processedRecheck.attempts).toBe(1);
    expect(processedRecheck.lockedAt).toBeTruthy();

    const recalculation = await prisma.recalculationLog.findFirstOrThrow({
      where: { tripId: trip.id, legId: leg.id, trigger: "recheck" },
    });
    expect(recalculation.status).toBe("skipped");

    const notificationCount = await prisma.notificationLog.count({
      where: { tripId: trip.id },
    });
    expect(notificationCount).toBe(0);
    expect(sendTelegramMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();

    const futureRemindersAfter = await prisma.reminderJob.findMany({
      where: { id: { in: futureRemindersBefore.map((job) => job.id) } },
      orderBy: { scheduledFor: "asc" },
    });
    expect(
      futureRemindersAfter.map((job) => ({
        id: job.id,
        status: job.status,
        scheduledFor: job.scheduledFor.toISOString(),
      }))
    ).toEqual(
      futureRemindersBefore.map((job) => ({
        id: job.id,
        status: "scheduled",
        scheduledFor: job.scheduledFor.toISOString(),
      }))
    );

    const unchangedLeg = await prisma.tripLeg.findUniqueOrThrow({
      where: { id: leg.id },
      include: { selectedCandidate: true },
    });
    expect(unchangedLeg.latestDepartAt?.toISOString()).toBe(
      leg.latestDepartAt?.toISOString()
    );
    expect(unchangedLeg.selectedCandidate?.totalMinutes).toBe(
      leg.selectedCandidate?.totalMinutes
    );
    await expect(
      prisma.agentMessage.findMany({
        where: { agentSessionId: session.id, role: "user" },
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("Current trip id"),
        }),
      ])
    );
  });
});
