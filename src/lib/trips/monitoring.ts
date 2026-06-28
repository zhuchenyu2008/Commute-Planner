import { prisma } from "@/lib/db";

export class TripMonitoringNotFoundError extends Error {
  constructor() {
    super("Trip not found.");
    this.name = "TripMonitoringNotFoundError";
  }
}

export type FormatMonitoredDurationInput = {
  createdAt: Date;
  now?: Date;
};

export type MonitoringSummaryInput = FormatMonitoredDurationInput & {
  scheduledReminderCount: number;
};

export type MonitoringStatusDisplayInput = {
  tripStatus?: string | null;
  latestRecalculation?: {
    status?: string | null;
    summary?: string | null;
    trigger?: string | null;
  } | null;
};

const MONITORING_STATUS_LABELS: Record<string, string> = {
  cancelled: "监控已取消",
  completed: "已完成",
  failed: "监控异常",
  monitoring: "监控已开启",
  planning: "规划中",
};

const MONITORING_STATUS_DESCRIPTIONS: Record<string, string> = {
  cancelled: "系统已停止监控该行程，并取消后续提醒。",
  completed: "该行程已完成，系统不再继续监控。",
  failed: "监控状态异常，请稍后重试或重新规划。",
  monitoring: "系统会在预定提醒和智能体复算时检查路线。",
  planning: "行程仍在规划中，完成后会进入监控。",
};

export function formatMonitoredDuration({
  createdAt,
  now = new Date(),
}: FormatMonitoredDurationInput) {
  const elapsedMs = Math.max(0, now.getTime() - createdAt.getTime());
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}分钟`;
  }

  if (minutes === 0) {
    return `${hours}小时`;
  }

  return `${hours}小时${minutes}分钟`;
}

export function getMonitoringSummary({
  createdAt,
  now,
  scheduledReminderCount,
}: MonitoringSummaryInput) {
  return {
    monitoredFor: formatMonitoredDuration({ createdAt, now }),
    scheduledReminderCount,
  };
}

export function getMonitoringStatusDisplay({
  tripStatus,
  latestRecalculation,
}: MonitoringStatusDisplayInput) {
  const normalizedStatus = tripStatus?.trim() || "monitoring";

  return {
    title: MONITORING_STATUS_LABELS[normalizedStatus] ?? normalizedStatus,
    description:
      MONITORING_STATUS_DESCRIPTIONS[normalizedStatus] ??
      "系统会在预定提醒和智能体复算时检查路线。",
    recalculationStatus: latestRecalculation?.status ?? null,
    recalculationSummary: latestRecalculation?.summary ?? null,
    trigger: latestRecalculation?.trigger ?? null,
  };
}

export async function cancelTripMonitoring(input: {
  tripId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: input.tripId, userId: input.userId },
      select: { id: true },
    });

    if (!trip) {
      throw new TripMonitoringNotFoundError();
    }

    await tx.reminderJob.updateMany({
      where: { tripId: trip.id, status: "scheduled" },
      data: { status: "cancelled" },
    });
    await tx.tripLeg.updateMany({
      where: { tripId: trip.id },
      data: { status: "cancelled" },
    });

    return tx.trip.update({
      where: { id: trip.id },
      data: { status: "cancelled" },
    });
  });
}
