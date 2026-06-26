import {
  addDaysToLocalDate,
  compareLocalStrings,
  formatLocalParts,
  getLocalParts,
  nowLocalString
} from "@/lib/time/local-time";

export type ArrivalParseOptions = {
  now?: Date;
  timezone?: string;
};

export type ArrivalParseResult = {
  rawText: string;
  destinationText: string;
  arriveByLocal: string;
  timezone: string;
  isPast: boolean;
};

export function parseArrivalRequest(text: string, options: ArrivalParseOptions = {}): ArrivalParseResult {
  const timezone = options.timezone || "Asia/Shanghai";
  const now = options.now || new Date();
  const normalized = text.trim().replace(/\s+/g, " ");
  const nowParts = getLocalParts(now, timezone);
  const dateOffset = inferDateOffset(normalized, nowParts);
  const localDate = addDaysToLocalDate(nowParts, dateOffset);
  const time = inferTime(normalized) || { hour: 9, minute: 0 };
  const arriveByLocal = formatLocalParts({
    ...localDate,
    hour: time.hour,
    minute: time.minute
  });
  const destinationText = inferDestination(normalized);
  const currentLocal = nowLocalString(now, timezone);

  return {
    rawText: text,
    destinationText,
    arriveByLocal,
    timezone,
    isPast: compareLocalStrings(arriveByLocal, currentLocal) < 0
  };
}

function inferDateOffset(text: string, now: { day: number }): number {
  if (/后天/.test(text)) {
    return 2;
  }
  if (/明天|明早|明晚/.test(text)) {
    return 1;
  }
  if (/今天|今晚|今早/.test(text)) {
    return 0;
  }
  if (/周|星期/.test(text)) {
    return inferWeekdayOffset(text);
  }
  return 1;
}

function inferWeekdayOffset(text: string) {
  const weekdays: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 0,
    天: 0
  };
  const match = text.match(/(?:周|星期)([一二三四五六日天])/);
  if (!match) {
    return 1;
  }
  const target = weekdays[match[1]];
  const today = new Date().getDay();
  const diff = (target - today + 7) % 7;
  return diff === 0 ? 7 : diff;
}

function inferTime(text: string): { hour: number; minute: number } | null {
  const colonMatch = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
  if (colonMatch) {
    return { hour: Number(colonMatch[1]), minute: Number(colonMatch[2]) };
  }

  const chineseMatch = text.match(/([一二三四五六七八九十两\d]{1,3})点(?:([一二三四五六七八九十\d]{1,3})分?)?/);
  if (!chineseMatch) {
    return null;
  }
  const hour = parseChineseNumber(chineseMatch[1]);
  const minute = chineseMatch[2] ? parseChineseNumber(chineseMatch[2]) : 0;
  if (hour > 23 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function inferDestination(text: string) {
  const withoutDate = text
    .replace(/后天|明天|今天|今晚|明早|明晚|今早/g, "")
    .replace(/(?:周|星期)[一二三四五六日天]/g, "")
    .replace(/([01]?\d|2[0-3])[:：]([0-5]\d)/g, "")
    .replace(/[一二三四五六七八九十两\d]{1,3}点(?:[一二三四五六七八九十\d]{1,3}分?)?/g, "")
    .trim();

  const destination = withoutDate
    .replace(/^(到|去|抵达|前往)\s*/, "")
    .replace(/^(要|想)\s*/, "")
    .replace(/\s*(到达|之前|前)$/g, "")
    .trim();

  return destination || "目的地";
}

function parseChineseNumber(raw: string) {
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };
  if (raw === "十") {
    return 10;
  }
  if (raw.includes("十")) {
    const [tens, ones] = raw.split("十");
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[raw] ?? 0;
}
