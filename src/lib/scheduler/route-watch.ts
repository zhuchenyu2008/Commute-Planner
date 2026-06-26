import { prisma } from "@/lib/db";
import { recheckTrip } from "@/lib/planning/planner";
import { nowLocalString } from "@/lib/time/local-time";
import { shouldSendRouteNotification } from "@/lib/notifications/policy";
import { sendEmail, sendTelegram } from "@/lib/notifications/channels";

let schedulerStarted = false;

export function startRouteWatchScheduler() {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;
  setInterval(() => {
    runDueRouteWatchJobs().catch((error) => {
      console.error("[scheduler] route-watch failed", error);
    });
  }, 60_000);
}

export async function runDueRouteWatchJobs(now = new Date()) {
  const jobs = await prisma.reminderJob.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: now }
    },
    include: { trip: true },
    take: 10,
    orderBy: { scheduledAt: "asc" }
  });

  for (const job of jobs) {
    try {
      await prisma.reminderJob.update({ where: { id: job.id }, data: { status: "running" } });
      const previousLatest = job.trip.latestDepartLocal;
      const trip = await recheckTrip(job.tripId);
      const decision = shouldSendRouteNotification({
        previousLatestDepartLocal: previousLatest,
        nextLatestDepartLocal: trip.latestDepartLocal || previousLatest || trip.arriveByLocal,
        thresholdMinutes: safeNumber(safeJson(trip.bufferJson).notifyThresholdMinutes, 5),
        nowLocal: nowLocalString(now, trip.timezone)
      });

      if (decision.shouldNotify) {
        const text = buildRouteWatchText(trip.destinationName, trip.latestDepartLocal || "", trip.totalMinutes || 0, decision.departNow);
        const dedupeKey = `${job.tripId}|${decision.departNow ? "depart" : "update"}|${trip.latestDepartLocal}`;
        const existing = await prisma.notificationLog.findFirst({ where: { dedupeKey, status: "sent" } });
        if (!existing) {
          const [telegram, email] = await Promise.all([
            sendTelegram(text),
            sendEmail(decision.departNow ? "出门提醒：请立即出发" : "出门提醒：路线时间更新", text)
          ]);
          for (const result of [telegram, email]) {
            await prisma.notificationLog.create({
              data: {
                tripId: trip.id,
                channel: result.channel,
                kind: decision.departNow ? "depart_now" : "route_update",
                dedupeKey,
                status: result.status,
                message: text,
                error: result.error
              }
            });
          }
        }
      }
      await prisma.reminderJob.update({ where: { id: job.id }, data: { status: "done", ranAt: new Date() } });
    } catch (error) {
      await prisma.reminderJob.update({
        where: { id: job.id },
        data: { status: "failed", lastError: error instanceof Error ? error.message : String(error), ranAt: new Date() }
      });
    }
  }

  return jobs.length;
}

function buildRouteWatchText(destination: string, latestDepartLocal: string, totalMinutes: number, departNow: boolean) {
  return [
    departNow ? "【出门提醒】请立即出发" : "【路程复算】出发时间有更新",
    `目的地：${destination}`,
    `建议最迟出发：${latestDepartLocal}`,
    `路程约 ${totalMinutes} 分钟`,
    "本次提醒依据锁定路线。"
  ].join("\n");
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function safeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
