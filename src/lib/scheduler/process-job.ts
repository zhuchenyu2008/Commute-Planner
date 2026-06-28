import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import {
  type NotificationSendStatus,
  writeNotificationLog,
} from "@/lib/notifications/log";
import { sendTelegram } from "@/lib/notifications/telegram";
import { findDueReminderJobs, lockReminderJob } from "./due-jobs";

export type SchedulerTickInput = {
  now?: Date;
};

export type SchedulerTickResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

type DueReminderJob = Awaited<ReturnType<typeof findDueReminderJobs>>[number];

function buildReminderText(job: DueReminderJob) {
  const leg = job.leg;
  const destination = leg?.destinationName ?? job.trip.finalStopName ?? job.trip.title;
  const when = job.scheduledFor.toISOString();

  if (job.kind === "depart_now") {
    return `Depart now for ${destination}. Reminder scheduled for ${when}.`;
  }

  return `Commute reminder for ${destination}. Agent-assisted recalculation checked this route at ${when}.`;
}

function summarizeRecalculation(job: DueReminderJob) {
  const leg = job.leg;
  const routeMinutes = leg?.selectedCandidate?.routeMinutes;
  const bufferMinutes = leg?.selectedCandidate?.bufferMinutes;
  const routeSummary =
    typeof routeMinutes === "number" && typeof bufferMinutes === "number"
      ? ` Existing route remains ${routeMinutes} minutes with ${bufferMinutes} minutes of buffer.`
      : "";

  return `Agent-assisted recalculation summary for ${job.trip.title}.${routeSummary}`;
}

function resolveJobStatus(
  statuses: NotificationSendStatus[]
): NotificationSendStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("sent")) return "sent";
  return "skipped";
}

async function processReminderJob(
  job: DueReminderJob,
  now: Date
): Promise<NotificationSendStatus> {
  const locked = await lockReminderJob(job.id, now);

  if (!locked) {
    return "skipped";
  }

  const content = buildReminderText(job);
  const subject = `Commute reminder: ${job.trip.title}`;
  const telegramChatId = job.trip.user.settings?.telegramChatId ?? null;
  const emailRecipient = job.trip.user.settings?.emailRecipient ?? null;

  let recalculationId: string | null = null;

  try {
    const recalculation = await prisma.recalculationLog.create({
      data: {
        tripId: job.tripId,
        legId: job.legId ?? null,
        trigger: "reminder",
        status: "running",
        summary: summarizeRecalculation(job),
      },
    });
    recalculationId = recalculation.id;

    const deliveryResults = await Promise.all([
      sendTelegram({ text: content, chatId: telegramChatId }).then(
        async (result) => {
          await writeNotificationLog({
            tripId: job.tripId,
            legId: job.legId,
            channel: "telegram",
            kind: job.kind,
            scheduledFor: job.scheduledFor,
            status: result.status,
            recipient: result.recipient,
            content,
            error: result.error,
          });

          return result.status;
        }
      ),
      sendEmail({ to: emailRecipient, subject, text: content }).then(
        async (result) => {
          await writeNotificationLog({
            tripId: job.tripId,
            legId: job.legId,
            channel: "email",
            kind: job.kind,
            scheduledFor: job.scheduledFor,
            status: result.status,
            recipient: result.recipient,
            content,
            error: result.error,
          });

          return result.status;
        }
      ),
    ]);

    const status = resolveJobStatus(deliveryResults);

    await prisma.$transaction([
      ...(recalculationId
        ? [
            prisma.recalculationLog.update({
              where: { id: recalculationId },
              data: { status },
            }),
          ]
        : []),
      prisma.reminderJob.update({
        where: { id: job.id },
        data: { status },
      }),
    ]);

    return status;
  } catch (error) {
    await prisma.$transaction([
      ...(recalculationId
        ? [
            prisma.recalculationLog.update({
              where: { id: recalculationId },
              data: {
                status: "failed",
                summary: `${summarizeRecalculation(job)} Failed to process notification logs.`,
              },
            }),
          ]
        : []),
      prisma.reminderJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      }),
    ]);

    return "failed";
  }
}

export async function processDueReminderJobs({
  now = new Date(),
}: SchedulerTickInput = {}): Promise<SchedulerTickResult> {
  const jobs = await findDueReminderJobs(now);
  const result: SchedulerTickResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const job of jobs) {
    const status = await processReminderJob(job, now);

    if (status === "skipped" && job.status !== "scheduled") {
      continue;
    }

    result.processed += 1;
    result[status] += 1;
  }

  return result;
}
