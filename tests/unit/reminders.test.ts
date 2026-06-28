import { describe, expect, it } from "vitest";
import { buildReminderSchedule } from "@/lib/trips/reminders";

describe("buildReminderSchedule", () => {
  it("builds the default recheck cadence and a depart-now reminder from latest departure", () => {
    const latestDepartAt = new Date("2026-07-01T09:00:00.000Z");

    const reminders = buildReminderSchedule({
      tripId: "trip_123",
      legId: "leg_456",
      latestDepartAt,
    });

    expect(reminders.map((reminder) => reminder.kind)).toEqual([
      "recheck",
      "recheck",
      "recheck",
      "recheck",
      "recheck",
      "depart_now",
    ]);
    expect(reminders.map((reminder) => reminder.scheduledFor.toISOString())).toEqual([
      "2026-07-01T08:30:00.000Z",
      "2026-07-01T08:40:00.000Z",
      "2026-07-01T08:45:00.000Z",
      "2026-07-01T08:50:00.000Z",
      "2026-07-01T08:55:00.000Z",
      "2026-07-01T09:00:00.000Z",
    ]);
    expect(reminders.map((reminder) => reminder.dedupeKey)).toEqual([
      "trip_123:leg_456:recheck:30",
      "trip_123:leg_456:recheck:20",
      "trip_123:leg_456:recheck:15",
      "trip_123:leg_456:recheck:10",
      "trip_123:leg_456:recheck:5",
      "trip_123:leg_456:depart_now:0",
    ]);
    expect(reminders.map((reminder) => JSON.parse(reminder.payloadJson))).toEqual([
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 30 },
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 20 },
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 15 },
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 10 },
      { tripId: "trip_123", legId: "leg_456", kind: "recheck", minutesBeforeDeparture: 5 },
      { tripId: "trip_123", legId: "leg_456", kind: "depart_now", minutesBeforeDeparture: 0 },
    ]);
  });
});
