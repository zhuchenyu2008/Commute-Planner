export type TripDisplayTone = "neutral" | "success" | "warning" | "danger";

export type TripDisplayStatusInput = {
  status: string;
  targetArriveAt?: Date | null;
  now?: Date;
};

export type TripDisplayStatus = {
  key: string;
  label: string;
  tone: TripDisplayTone;
  isExpired: boolean;
};

export const TRIP_STATUS_LABELS: Record<string, string> = {
  cancelled: "已取消",
  completed: "已完成",
  failed: "失败",
  monitoring: "监控中",
  planning: "规划中",
  running: "运行中",
  scheduled: "已计划",
  timed_out: "已超时",
};

const TRIP_STATUS_TONES: Record<string, TripDisplayTone> = {
  cancelled: "neutral",
  completed: "neutral",
  failed: "danger",
  monitoring: "success",
  planning: "warning",
  running: "warning",
  scheduled: "success",
  timed_out: "danger",
};

export function isExpiredTripStatus({
  status,
  targetArriveAt,
  now = new Date(),
}: TripDisplayStatusInput) {
  return Boolean(
    (status === "monitoring" || status === "scheduled") &&
      targetArriveAt &&
      targetArriveAt.getTime() < now.getTime()
  );
}

export function getTripDisplayStatus(
  input: TripDisplayStatusInput
): TripDisplayStatus {
  if (isExpiredTripStatus(input)) {
    return {
      key: "expired",
      label: "已过期",
      tone: "warning",
      isExpired: true,
    };
  }

  return {
    key: input.status,
    label: TRIP_STATUS_LABELS[input.status] ?? input.status,
    tone: TRIP_STATUS_TONES[input.status] ?? "neutral",
    isExpired: false,
  };
}
