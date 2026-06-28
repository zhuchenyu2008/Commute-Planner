import { prisma } from "@/lib/db";

export async function findDueReminderJobs(now: Date, limit = 25) {
  return prisma.reminderJob.findMany({
    where: {
      status: "scheduled",
      scheduledFor: { lte: now },
    },
    include: {
      trip: {
        include: {
          user: {
            include: { settings: true },
          },
        },
      },
      leg: {
        include: {
          selectedCandidate: true,
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
