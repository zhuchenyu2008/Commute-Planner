export const APP_TIME_ZONE = "Asia/Shanghai";

const PENDING_TIME_LABEL = "待定";

function resolveTimeZone(timeZone?: string | null) {
  const normalized = timeZone?.trim();
  return normalized || APP_TIME_ZONE;
}

function formatWithTimeZone(
  date: Date | null | undefined,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions
) {
  if (!date) {
    return PENDING_TIME_LABEL;
  }

  const resolvedTimeZone = resolveTimeZone(timeZone);

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      ...options,
      timeZone: resolvedTimeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      ...options,
      timeZone: APP_TIME_ZONE,
    }).format(date);
  }
}

export function formatTimeInTimeZone(
  date?: Date | null,
  timeZone?: string | null
) {
  return formatWithTimeZone(date, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTimeInTimeZone(
  date?: Date | null,
  timeZone?: string | null
) {
  return formatWithTimeZone(date, timeZone, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
