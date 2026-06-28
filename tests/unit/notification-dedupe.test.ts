import { describe, expect, it } from "vitest";
import { buildNotificationDedupeKey } from "@/lib/notifications/log";

describe("buildNotificationDedupeKey", () => {
  it("builds a stable key from trip, leg, channel, kind, and scheduled time", () => {
    const scheduledFor = new Date("2026-07-01T08:30:00.000Z");

    expect(
      buildNotificationDedupeKey({
        tripId: "trip_123",
        legId: "leg_456",
        channel: "telegram",
        kind: "recheck",
        scheduledFor,
      })
    ).toBe("trip_123:leg_456:telegram:recheck:2026-07-01T08:30:00.000Z");
  });

  it("uses trip when a notification is not tied to a leg", () => {
    const scheduledFor = new Date("2026-07-01T09:00:00.000Z");

    expect(
      buildNotificationDedupeKey({
        tripId: "trip_123",
        channel: "email",
        kind: "depart_now",
        scheduledFor,
      })
    ).toBe("trip_123:trip:email:depart_now:2026-07-01T09:00:00.000Z");
  });
});
