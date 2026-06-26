const DATE_TIME_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getFormatter(timezone: string) {
  const cached = DATE_TIME_FORMATTER_CACHE.get(timezone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  DATE_TIME_FORMATTER_CACHE.set(timezone, formatter);
  return formatter;
}

export function getLocalParts(date: Date, timezone: string): LocalParts {
  const parts = getFormatter(timezone).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

export function formatLocalParts(parts: LocalParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function addDaysToLocalDate(parts: LocalParts, days: number): LocalParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

export function addMinutesToLocalString(local: string, minutes: number): string {
  const parts = parseLocalDateTime(local);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute + minutes));
  return formatLocalParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  });
}

export function diffLocalMinutes(nextLocal: string, previousLocal: string): number {
  const next = localStringToPseudoUtc(nextLocal).getTime();
  const previous = localStringToPseudoUtc(previousLocal).getTime();
  return Math.round((next - previous) / 60_000);
}

export function compareLocalStrings(a: string, b: string): number {
  return localStringToPseudoUtc(a).getTime() - localStringToPseudoUtc(b).getTime();
}

export function nowLocalString(now: Date, timezone: string): string {
  return formatLocalParts(getLocalParts(now, timezone));
}

export function parseLocalDateTime(local: string): LocalParts {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid local datetime: ${local}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
}

function localStringToPseudoUtc(local: string) {
  const parts = parseLocalDateTime(local);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
