import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readEnv } from "@/lib/env";

function asOptionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value.trim() : undefined;
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id }
  });

  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const env = readEnv();
  const data = {
    defaultCity:
      asOptionalString(body.defaultCity) || env.defaultCity,
    timezone: asOptionalString(body.timezone) || env.defaultTimezone,
    originName:
      asOptionalString(body.originName) || env.defaultOriginName,
    originLngLat:
      asOptionalString(body.originLngLat) || env.defaultOrigin,
    routePreference:
      asOptionalString(body.routePreference) || "balanced",
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
