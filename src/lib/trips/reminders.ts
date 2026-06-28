import type { ReminderJobData, ReminderKind } from "@/lib/trips/types";

export const DEFAULT_REMINDER_CADENCE_MINUTES = [30, 20, 15, 10, 5, 0] as const;

export type BuildReminderScheduleInput = {
  tripId: string;
  legId: string;
  latestDepartAt: Date;
  cadenceMinutes?: readonly number[];
};

export function buildReminderSchedule({
  tripId,
  legId,
  latestDepartAt,
  cadenceMinutes = DEFAULT_REMINDER_CADENCE_MINUTES,
}: BuildReminderScheduleInput): ReminderJobData[] {
  return cadenceMinutes.map((minutesBeforeDeparture) => {
    const kind: ReminderKind =
      minutesBeforeDeparture === 0 ? "depart_now" : "recheck";
    const scheduledFor = new Date(
      latestDepartAt.getTime() - minutesBeforeDeparture * 60_000
    );

    return {
      tripId,
      legId,
      kind,
      scheduledFor,
      dedupeKey: `${tripId}:${legId}:${kind}:${minutesBeforeDeparture}`,
      payloadJson: JSON.stringify({
        tripId,
        legId,
        kind,
        minutesBeforeDeparture,
      }),
    };
  });
}
