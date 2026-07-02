import {
  AgentSessionAlreadyRunningError,
  AgentSessionNotFoundError,
  acceptAgentSessionMessage,
  runAcceptedContinuationSession,
  type RunPlanningSessionOptions,
} from "@/lib/agent/planner";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
  type BuiltEmailTemplate,
  type CommuteEmailTemplateInput,
} from "@/lib/notifications/email-templates";
import { buildAmapLink } from "@/lib/notifications/map-links";
import {
  buildNotificationDedupeKey,
  type NotificationSendStatus,
  writeNotificationLog,
} from "@/lib/notifications/log";
import { sendTelegram } from "@/lib/notifications/telegram";
import { replaceReminderSchedule } from "@/lib/trips/route-updates";
import {
  expireStaleReminderJobs,
  findDueReminderJobs,
  lockReminderJob,
  STALE_REMINDER_GRACE_MS,
} from "./due-jobs";

export type SchedulerTickInput = {
  now?: Date;
  agentOptions?: RunPlanningSessionOptions;
  staleGraceMs?: number;
};

export type SchedulerTickResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

type DueReminderJob = Awaited<ReturnType<typeof findDueReminderJobs>>[number];
type RouteSnapshot = ReturnType<typeof snapshotLeg>;
type SnapshotLegInput = {
  id: string;
  order: number;
  latestDepartAt: Date | null;
  selectedCandidate?: {
    routeMinutes: number;
    totalMinutes: number;
  } | null;
} | null | undefined;
type EmailTemplateLegInput = {
  destinationName: string | null;
  destinationLngLat?: string | null;
  latestDepartAt: Date | null;
  targetArriveAt: Date | null;
  trip?: EmailTemplateTripInput;
  selectedCandidate?: {
    title: string;
    routeMinutes: number;
    totalMinutes: number;
  } | null;
  routeSegments?: {
    title: string;
    order: number;
  }[];
} | null | undefined;
type EmailTemplateTripInput = {
  title: string;
  targetArriveAt: Date | null;
  finalStopName: string | null;
} | null | undefined;

const DEFAULT_ROUTE_CHANGE_THRESHOLD_MINUTES = 3;

function formatBeijingTime(date: Date | null | undefined) {
  if (!date) return "未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function buildReminderText(job: DueReminderJob) {
  const leg = job.leg;
  const destination =
    leg?.destinationName ?? job.trip.finalStopName ?? job.trip.title;
  const when = formatBeijingTime(job.scheduledFor);

  if (job.kind === "depart_now") {
    return `现在出发前往 ${destination}。提醒计划时间：${when}。`;
  }

  return `通勤提醒：前往 ${destination}。智能体已在 ${when} 复查路线。`;
}

function summarizeRecalculation(job: DueReminderJob) {
  const leg = job.leg;
  const routeMinutes = leg?.selectedCandidate?.routeMinutes;
  const bufferMinutes = leg?.selectedCandidate?.bufferMinutes;
  const routeSummary =
    typeof routeMinutes === "number" && typeof bufferMinutes === "number"
      ? ` 当前路线为 ${routeMinutes} 分钟，缓冲 ${bufferMinutes} 分钟。`
      : "";

  return `智能体辅助复算：${job.trip.title}。${routeSummary}`;
}

function resolveJobStatus(
  statuses: NotificationSendStatus[]
): NotificationSendStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("sent")) return "sent";
  return "skipped";
}

function normalizeNotificationStatus(status: string): NotificationSendStatus {
  if (status === "sent" || status === "failed" || status === "skipped") {
    return status;
  }

  return "skipped";
}

async function getLoggedNotificationStatus(input: {
  tripId: string;
  legId?: string | null;
  channel: string;
  kind: string;
  scheduledFor: Date;
}) {
  const existing = await prisma.notificationLog.findUnique({
    where: { dedupeKey: buildNotificationDedupeKey(input) },
    select: { status: true },
  });

  return existing ? normalizeNotificationStatus(existing.status) : null;
}

function getSessionIdForRecheck(job: DueReminderJob) {
  return job.trip.agentSessionId ?? job.trip.agentSessions[0]?.id ?? null;
}

function getRouteChangeThresholdMinutes(job: DueReminderJob) {
  const value = job.trip.user.settings?.routeChangeThresholdMinutes;

  return typeof value === "number" && value > 0
    ? value
    : DEFAULT_ROUTE_CHANGE_THRESHOLD_MINUTES;
}

function getReminderCadenceMinutes(job: DueReminderJob) {
  const raw = job.trip.user.settings?.reminderCadenceJson;

  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const values = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);

    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

function absoluteAppUrl(path: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) return undefined;

  try {
    const parsedBaseUrl = new URL(baseUrl);

    if (
      parsedBaseUrl.protocol !== "http:" &&
      parsedBaseUrl.protocol !== "https:"
    ) {
      return undefined;
    }

    return new URL(path, parsedBaseUrl).toString();
  } catch {
    return undefined;
  }
}

function summarizeRouteTitle(leg: EmailTemplateLegInput) {
  const segmentTitle = leg?.routeSegments
    ?.map((segment) => segment.title)
    .filter(Boolean)
    .join(" -> ");

  return (
    leg?.selectedCandidate?.title ??
    (segmentTitle || null) ??
    "查看行程详情"
  );
}

function getTotalMinutes(leg: EmailTemplateLegInput) {
  return (
    leg?.selectedCandidate?.totalMinutes ??
    leg?.selectedCandidate?.routeMinutes ??
    null
  );
}

function buildEmailTemplateInput(
  job: DueReminderJob,
  leg: EmailTemplateLegInput = job.leg,
  trip: EmailTemplateTripInput = leg?.trip ?? job.trip
): CommuteEmailTemplateInput {
  const tripTitle = trip?.title ?? job.trip.title;
  const destination =
    leg?.destinationName ??
    trip?.finalStopName ??
    job.trip.finalStopName ??
    tripTitle;
  const tripPath = `/trips/${job.tripId}`;

  return {
    tripTitle,
    destinationName: destination,
    latestDepartAt: leg?.latestDepartAt ?? job.scheduledFor,
    targetArriveAt:
      leg?.targetArriveAt ?? trip?.targetArriveAt ?? job.trip.targetArriveAt,
    totalMinutes: getTotalMinutes(leg),
    routeTitle: summarizeRouteTitle(leg),
    weatherSummary: "以行程详情为准",
    detailsUrl: buildAmapLink({
      destinationName: destination,
      destinationLngLat: leg?.destinationLngLat,
    }),
    stopMonitoringUrl: absoluteAppUrl(tripPath),
  };
}

function snapshotLeg(leg: SnapshotLegInput) {
  if (!leg) return null;

  return {
    id: leg.id,
    order: leg.order,
    latestDepartAt: leg.latestDepartAt,
    routeMinutes: leg.selectedCandidate?.routeMinutes ?? null,
    totalMinutes: leg.selectedCandidate?.totalMinutes ?? null,
  };
}

async function loadCurrentLegSnapshot(job: DueReminderJob, legOrder?: number) {
  const clauses = [];

  if (job.legId) {
    clauses.push({ id: job.legId });
  }

  if (legOrder !== undefined) {
    clauses.push({ order: legOrder });
  }

  if (clauses.length === 0) {
    return null;
  }

  const leg = await prisma.tripLeg.findFirst({
    where: {
      tripId: job.tripId,
      OR: clauses,
    },
    include: { selectedCandidate: true },
    orderBy: { updatedAt: "desc" },
  });

  return snapshotLeg(leg);
}

async function loadCurrentLegForEmail(job: DueReminderJob, legOrder?: number) {
  const clauses = [];

  if (job.legId) {
    clauses.push({ id: job.legId });
  }

  if (legOrder !== undefined) {
    clauses.push({ order: legOrder });
  }

  if (clauses.length === 0) {
    return null;
  }

  return prisma.tripLeg.findFirst({
    where: {
      tripId: job.tripId,
      OR: clauses,
    },
    include: {
      trip: {
        select: {
          title: true,
          targetArriveAt: true,
          finalStopName: true,
        },
      },
      selectedCandidate: true,
      routeSegments: {
        select: { title: true, order: true },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

function differenceInMinutes(
  before: Date | number | null | undefined,
  after: Date | number | null | undefined
) {
  if (
    before === null ||
    before === undefined ||
    after === null ||
    after === undefined
  ) {
    return null;
  }

  if (before instanceof Date && after instanceof Date) {
    return Math.abs(after.getTime() - before.getTime()) / 60_000;
  }

  if (typeof before === "number" && typeof after === "number") {
    return Math.abs(after - before);
  }

  return null;
}

function measureRouteChangeMinutes(before: RouteSnapshot, after: RouteSnapshot) {
  const differences = [
    differenceInMinutes(before?.latestDepartAt, after?.latestDepartAt),
    differenceInMinutes(before?.totalMinutes, after?.totalMinutes),
    differenceInMinutes(before?.routeMinutes, after?.routeMinutes),
  ].filter((value): value is number => typeof value === "number");

  return differences.length > 0 ? Math.max(...differences) : 0;
}

function buildRecheckMessage(job: DueReminderJob, thresholdMinutes: number) {
  const leg = job.leg;
  const destination =
    leg?.destinationName ?? job.trip.finalStopName ?? job.trip.title;

  return [
    `路线复查：请重新核对当前行程 ${job.trip.title} 前往 ${destination} 的路线。`,
    `Current trip id: ${job.tripId}.`,
    `只要路线耗时或最晚出发时间变化没有大于 ${thresholdMinutes} 分钟，就保持现有提醒计划，不要主动通知用户。`,
    "如果变化大于阈值，请用当前路线更新工具修改行程路线或最晚出发时间；系统会据此刷新后续提醒并通知用户时间已变化。",
  ].join("\n");
}

function buildRouteChangedText(input: {
  job: DueReminderJob;
  changeMinutes: number;
  latestDepartAt?: Date | null;
}) {
  const destination =
    input.job.leg?.destinationName ??
    input.job.trip.finalStopName ??
    input.job.trip.title;
  const roundedChange = Math.round(input.changeMinutes);

  return [
    `路线时间已变化：前往 ${destination} 的路线比上次计划变化约 ${roundedChange} 分钟。`,
    `后续提醒时间已更新。当前最晚出发时间：${formatBeijingTime(
      input.latestDepartAt
    )}。`,
  ].join("\n");
}

async function deliverReminderNotification(input: {
  job: DueReminderJob;
  subject: string;
  content: string;
  email?: BuiltEmailTemplate;
  notificationKind?: string;
  notificationLegId?: string | null;
}) {
  const telegramChatId = input.job.trip.user.settings?.telegramChatId ?? null;
  const emailRecipient = input.job.trip.user.settings?.emailRecipient ?? null;
  const notificationKind = input.notificationKind ?? input.job.kind;
  const notificationLegId =
    input.notificationLegId === undefined
      ? input.job.legId
      : input.notificationLegId;

  return Promise.all([
    (async () => {
      const loggedStatus = await getLoggedNotificationStatus({
        tripId: input.job.tripId,
        legId: notificationLegId,
        channel: "telegram",
        kind: notificationKind,
        scheduledFor: input.job.scheduledFor,
      });

      if (loggedStatus) return loggedStatus;

      const result = await sendTelegram({
        text: input.content,
        chatId: telegramChatId,
      });
        await writeNotificationLog({
          tripId: input.job.tripId,
          legId: notificationLegId,
          channel: "telegram",
          kind: notificationKind,
          scheduledFor: input.job.scheduledFor,
          status: result.status,
          recipient: result.recipient,
          content: input.content,
          error: result.error,
        });

        return result.status;
    })(),
    (async () => {
      const loggedStatus = await getLoggedNotificationStatus({
        tripId: input.job.tripId,
        legId: notificationLegId,
        channel: "email",
        kind: notificationKind,
        scheduledFor: input.job.scheduledFor,
      });

      if (loggedStatus) return loggedStatus;

      const result = await sendEmail({
        to: emailRecipient,
        subject: input.email?.subject ?? input.subject,
        text: input.email?.text ?? input.content,
        html: input.email?.html,
        attachments: input.email?.attachments,
      });
      await writeNotificationLog({
        tripId: input.job.tripId,
        legId: notificationLegId,
        channel: "email",
        kind: notificationKind,
        scheduledFor: input.job.scheduledFor,
        status: result.status,
        recipient: result.recipient,
        content: input.content,
        error: result.error,
      });

      return result.status;
    })(),
  ]);
}

async function finishJob(input: {
  job: DueReminderJob;
  status: NotificationSendStatus;
  recalculationId?: string | null;
  summary?: string;
}) {
  await prisma.$transaction([
    ...(input.recalculationId
      ? [
          prisma.recalculationLog.update({
            where: { id: input.recalculationId },
            data: {
              status: input.status,
              ...(input.summary ? { summary: input.summary } : {}),
            },
          }),
        ]
      : []),
    prisma.reminderJob.update({
      where: { id: input.job.id },
      data: { status: input.status },
    }),
  ]);
}

async function processDepartureReminderJob(
  job: DueReminderJob,
  now: Date
): Promise<NotificationSendStatus> {
  const locked = await lockReminderJob(job.id, now);

  if (!locked) {
    return "skipped";
  }

  const content = buildReminderText(job);
  const email = buildDepartureReminderEmail(buildEmailTemplateInput(job));
  const subject = email.subject;
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

    const deliveryResults = await deliverReminderNotification({
      job,
      subject,
      content,
      email,
    });
    const status = resolveJobStatus(deliveryResults);

    await finishJob({ job, status, recalculationId });

    return status;
  } catch {
    await prisma.$transaction([
      ...(recalculationId
        ? [
            prisma.recalculationLog.update({
              where: { id: recalculationId },
              data: {
                status: "failed",
                summary: `${summarizeRecalculation(job)} 通知日志处理失败。`,
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

async function refreshReminderScheduleAfterRouteChange(
  job: DueReminderJob,
  now: Date,
  legOrder?: number
) {
  await replaceReminderSchedule({
    tripId: job.tripId,
    userId: job.trip.userId,
    legId: job.legId ?? undefined,
    legOrder,
    cadenceMinutes: getReminderCadenceMinutes(job),
    now,
  });
}

async function processRouteRecheckJob(
  job: DueReminderJob,
  now: Date,
  agentOptions?: RunPlanningSessionOptions
): Promise<NotificationSendStatus> {
  const locked = await lockReminderJob(job.id, now);

  if (!locked) {
    return "skipped";
  }

  const thresholdMinutes = getRouteChangeThresholdMinutes(job);
  const sessionId = getSessionIdForRecheck(job);
  const before = snapshotLeg(job.leg);
  const recalculation = await prisma.recalculationLog.create({
    data: {
      tripId: job.tripId,
      legId: job.legId ?? null,
      trigger: "recheck",
      status: "running",
      summary: summarizeRecalculation(job),
    },
  });

  if (!sessionId) {
    await finishJob({
      job,
      status: "skipped",
      recalculationId: recalculation.id,
      summary: "路线复查已跳过：该行程没有可继续的智能体会话。",
    });
    return "skipped";
  }

  try {
    await acceptAgentSessionMessage({
      userId: job.trip.userId,
      sessionId,
      message: buildRecheckMessage(job, thresholdMinutes),
    });

    const runResult = await runAcceptedContinuationSession(
      sessionId,
      agentOptions
    );

    if (runResult.status !== "completed") {
      await finishJob({
        job,
        status: "failed",
        recalculationId: recalculation.id,
        summary: `路线复查失败：智能体会话状态为 ${runResult.status}。`,
      });
      return "failed";
    }

    const after = await loadCurrentLegSnapshot(job, before?.order);
    const changeMinutes = measureRouteChangeMinutes(before, after);

    if (changeMinutes <= thresholdMinutes) {
      await finishJob({
        job,
        status: "skipped",
        recalculationId: recalculation.id,
        summary: `路线复查完成：时间变化 ${changeMinutes.toFixed(
          1
        )} 分钟，未超过 ${thresholdMinutes} 分钟阈值。`,
      });
      return "skipped";
    }

    await refreshReminderScheduleAfterRouteChange(job, now, before?.order);
    const currentLeg = await loadCurrentLegForEmail(job, before?.order);
    const latestDepartAt =
      after?.latestDepartAt ??
      currentLeg?.latestDepartAt ??
      job.leg?.latestDepartAt ??
      job.scheduledFor;
    const content = buildRouteChangedText({
      job,
      changeMinutes,
      latestDepartAt,
    });
    const email = buildRouteChangeEmail({
      ...buildEmailTemplateInput(job, currentLeg ?? job.leg),
      latestDepartAt,
      previousLatestDepartAt: before?.latestDepartAt ?? job.leg?.latestDepartAt,
      changeMinutes,
    });
    const deliveryResults = await deliverReminderNotification({
      job,
      subject: email.subject,
      content,
      email,
      notificationKind: "route_change",
      notificationLegId: after?.id ?? null,
    });
    const status = resolveJobStatus(deliveryResults);

    await finishJob({
      job,
      status,
      recalculationId: recalculation.id,
      summary: `路线复查完成：时间变化 ${changeMinutes.toFixed(
        1
      )} 分钟，已更新后续提醒。`,
    });

    return status;
  } catch (error) {
    if (
      error instanceof AgentSessionNotFoundError ||
      error instanceof AgentSessionAlreadyRunningError
    ) {
      await finishJob({
        job,
        status: "skipped",
        recalculationId: recalculation.id,
        summary: `路线复查已跳过：${
          error instanceof AgentSessionAlreadyRunningError
            ? "智能体会话正在运行。"
            : "未找到智能体会话。"
        }`,
      });
      return "skipped";
    }

    await finishJob({
      job,
      status: "failed",
      recalculationId: recalculation.id,
      summary:
        error instanceof Error
          ? `路线复查失败：${error.message}`
          : "路线复查失败。",
    });
    return "failed";
  }
}

async function processReminderJob(
  job: DueReminderJob,
  now: Date,
  agentOptions?: RunPlanningSessionOptions
): Promise<NotificationSendStatus> {
  if (job.kind === "recheck") {
    return processRouteRecheckJob(job, now, agentOptions);
  }

  return processDepartureReminderJob(job, now);
}

export async function processDueReminderJobs({
  now = new Date(),
  agentOptions,
  staleGraceMs = STALE_REMINDER_GRACE_MS,
}: SchedulerTickInput = {}): Promise<SchedulerTickResult> {
  const result: SchedulerTickResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  const expired = await expireStaleReminderJobs(now, staleGraceMs);
  result.skipped += expired;
  const jobs = await findDueReminderJobs(now, 25, staleGraceMs);

  for (const job of jobs) {
    const status = await processReminderJob(job, now, agentOptions);

    if (status === "skipped" && job.status !== "scheduled") {
      continue;
    }

    result.processed += 1;
    result[status] += 1;
  }

  return result;
}
