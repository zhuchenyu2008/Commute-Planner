import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type NotificationChannel = "telegram" | "email";
export type NotificationSendStatus = "sent" | "skipped" | "failed";

export type NotificationDedupeInput = {
  tripId: string;
  legId?: string | null;
  channel: string;
  kind: string;
  scheduledFor: Date;
};

export type NotificationLogInput = NotificationDedupeInput & {
  status: NotificationSendStatus;
  recipient?: string | null;
  content: string;
  error?: string | null;
};

export function buildNotificationDedupeKey(input: NotificationDedupeInput) {
  const legSegment = input.legId ?? "trip";

  return [
    input.tripId,
    legSegment,
    input.channel,
    input.kind,
    input.scheduledFor.toISOString(),
  ].join(":");
}

export async function writeNotificationLog(input: NotificationLogInput) {
  const dedupeKey = buildNotificationDedupeKey(input);

  try {
    return await prisma.notificationLog.upsert({
      where: { dedupeKey },
      create: {
        tripId: input.tripId,
        legId: input.legId ?? null,
        channel: input.channel,
        status: input.status,
        recipient: input.recipient ?? null,
        dedupeKey,
        content: input.content,
        error: input.error ?? null,
      },
      update: {},
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.notificationLog.findUniqueOrThrow({ where: { dedupeKey } });
    }

    throw error;
  }
}
