import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";

function getSettingsDefaults() {
  const env = readEnv();
  return {
    defaultCity: env.defaultCity,
    timezone: env.defaultTimezone,
    originName: env.defaultOriginName,
    originLngLat: env.defaultOrigin,
    routePreference: "balanced",
    telegramChatId: null,
    emailRecipient: null
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

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id }
  });

  return NextResponse.json({ settings: settings ?? getSettingsDefaults() });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const defaults = getSettingsDefaults();
  const data = {
    defaultCity:
      asOptionalString(body.defaultCity) || defaults.defaultCity,
    timezone: asOptionalString(body.timezone) || defaults.timezone,
    originName:
      asOptionalString(body.originName) || defaults.originName,
    originLngLat:
      asOptionalString(body.originLngLat) || defaults.originLngLat,
    routePreference:
      asOptionalString(body.routePreference) || defaults.routePreference,
    telegramChatId: asOptionalString(body.telegramChatId) ?? null,
    emailRecipient: asOptionalString(body.emailRecipient) ?? null
  };

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: data,
    create: {
      userId: user.id,
      ...data
    }
  });

  return NextResponse.json({ settings });
}
