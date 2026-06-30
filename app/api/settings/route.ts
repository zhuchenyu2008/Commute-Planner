import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";

const ROUTE_PREFERENCES = new Set(["balanced", "fastest", "habit", "transit", "bike"]);
const TIMEZONES = new Set(["Asia/Shanghai"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LNG_LAT_PATTERN = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;
const TELEGRAM_CHAT_ID_CONFLICT_DETAIL =
  "Telegram Chat ID 已被其他用户绑定，请使用自己的 Chat ID 或先解除原绑定。";

function getSettingsDefaults() {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    originName: null,
    originLngLat: null,
    routePreference: "balanced",
    telegramChatId: null,
    emailRecipient: null,
  };
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRequiredString(body: Record<string, unknown>, key: string, fallback: string): string {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return fallback;
  }

  return asOptionalString(body[key]) ?? "";
}

function isValidLngLat(value: string) {
  if (!LNG_LAT_PATTERN.test(value)) return false;
  const [lng, lat] = value.split(",").map(Number);
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function validateSettings(data: {
  defaultCity: string;
  timezone: string;
  originName: string | null;
  originLngLat: string | null;
  routePreference: string;
  telegramChatId: string | null;
  emailRecipient: string | null;
}) {
  const errors: string[] = [];

  if (!data.defaultCity) errors.push("默认城市不能为空");
  if (!TIMEZONES.has(data.timezone)) errors.push("不支持该时区");
  if (Boolean(data.originName) !== Boolean(data.originLngLat)) {
    errors.push("默认出发点必须从候选地点中选择");
  }
  if (data.originLngLat && !isValidLngLat(data.originLngLat)) {
    errors.push("默认出发点坐标无效");
  }
  if (!ROUTE_PREFERENCES.has(data.routePreference)) {
    errors.push("不支持该通勤方式倾向");
  }
  if (data.emailRecipient && !EMAIL_PATTERN.test(data.emailRecipient)) {
    errors.push("邮件接收人格式无效");
  }

  return errors;
}

function isTelegramChatIdUniqueViolation(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  const target = error.meta?.target;
  return (
    error.code === "P2002" &&
    (target === "UserSettings_telegramChatId_key" ||
      (Array.isArray(target) && target.includes("telegramChatId")))
  );
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id }
  });
  const values = settings ?? getSettingsDefaults();

  return NextResponse.json({
    settings: {
      ...values,
      originName: values.originName ?? "",
      originLngLat: values.originLngLat ?? "",
    },
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const defaults = getSettingsDefaults();
  const originName = asOptionalString(body.originName) ?? null;
  const originLngLat = asOptionalString(body.originLngLat) ?? null;
  const data = {
    defaultCity: readRequiredString(body, "defaultCity", defaults.defaultCity),
    timezone: readRequiredString(body, "timezone", defaults.timezone),
    originName,
    originLngLat,
    routePreference: readRequiredString(body, "routePreference", defaults.routePreference),
    telegramChatId: asOptionalString(body.telegramChatId) ?? null,
    emailRecipient: asOptionalString(body.emailRecipient) ?? null,
  };
  const errors = validateSettings(data);

  if (errors.length > 0) {
    return NextResponse.json({ error: "设置无效", details: errors }, { status: 400 });
  }

  if (data.telegramChatId) {
    const existingTelegramBinding = await prisma.userSettings.findFirst({
      where: {
        telegramChatId: data.telegramChatId,
        userId: { not: user.id },
      },
      select: { id: true },
    });

    if (existingTelegramBinding) {
      return NextResponse.json(
        { error: "设置无效", details: [TELEGRAM_CHAT_ID_CONFLICT_DETAIL] },
        { status: 400 }
      );
    }
  }

  try {
    const settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: data,
      create: {
        userId: user.id,
        ...data
      }
    });

    return NextResponse.json({ settings });
  } catch (error) {
    if (isTelegramChatIdUniqueViolation(error)) {
      return NextResponse.json(
        { error: "设置无效", details: [TELEGRAM_CHAT_ID_CONFLICT_DETAIL] },
        { status: 400 }
      );
    }

    throw error;
  }
}
