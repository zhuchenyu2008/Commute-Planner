import { prisma } from "@/lib/db";

export const STALE_REMINDER_GRACE_MS = 90_000;

export async function expireStaleReminderJobs(
  now: Date,
  graceMs = STALE_REMINDER_GRACE_MS
) {
  const staleBefore = new Date(now.getTime() - graceMs);
  const result = await prisma.reminderJob.updateMany({
    where: {
      status: "scheduled",
      scheduledFor: { lt: staleBefore },
    },
    data: { status: "skipped" },
  });

  return result.count;
}

export async function findDueReminderJobs(
  now: Date,
  limit = 25,
  graceMs = STALE_REMINDER_GRACE_MS
) {
  const dueAfter = new Date(now.getTime() - graceMs);

  return prisma.reminderJob.findMany({
    where: {
      status: "scheduled",
      scheduledFor: {
        gte: dueAfter,
        lte: now,
      },
    },
    include: {
      trip: {
        include: {
          user: {
            include: { settings: true },
          },
          agentSessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      leg: {
        include: {
          selectedCandidate: true,
          routeSegments: {
            select: { title: true, order: true },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });
}

export async function lockReminderJob(id: string, now: Date) {
  const result = await prisma.reminderJob.updateMany({
    where: {
      id,
      status: "scheduled",
    },
    data: {
      status: "running",
      lockedAt: now,
      attempts: { increment: 1 },
    },
  });

  return result.count === 1;
}
