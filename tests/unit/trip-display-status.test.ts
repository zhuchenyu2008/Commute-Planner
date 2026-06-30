import { describe, expect, it } from "vitest";
import {
  formatReminderStatus,
  getMonitoringStatusDisplay,
} from "@/lib/trips/monitoring";
import { getTripDisplayStatus } from "@/lib/trips/display-status";

describe("trip display status helpers", () => {
  const now = new Date("2026-06-30T01:00:00.000Z");

  it("shows expired monitoring trips as expired after the target arrival time", () => {
    expect(
      getMonitoringStatusDisplay({
        tripStatus: "monitoring",
        targetArriveAt: new Date("2026-06-30T00:30:00.000Z"),
        now,
      })
    ).toMatchObject({
      title: "已过期",
      description: "目标到达时间已过，系统不再把它当作等待中的通勤。",
    });
  });

  it("labels future scheduled reminders by reminder kind", () => {
    expect(
      formatReminderStatus({
        status: "scheduled",
        kind: "recheck",
        scheduledFor: new Date("2026-06-30T01:10:00.000Z"),
        now,
      })
    ).toBe("等待复查");
    expect(
      formatReminderStatus({
        status: "scheduled",
        kind: "depart_now",
        scheduledFor: new Date("2026-06-30T01:20:00.000Z"),
        now,
      })
    ).toBe("等待提醒");
  });

  it("labels stale scheduled reminders as expired", () => {
    expect(
      formatReminderStatus({
        status: "scheduled",
        kind: "recheck",
        scheduledFor: new Date("2026-06-30T00:50:00.000Z"),
        now,
      })
    ).toBe("已过期");
  });

  it("formats expired monitoring trips for list displays", () => {
    expect(
      getTripDisplayStatus({
        status: "monitoring",
        targetArriveAt: new Date("2026-06-30T00:30:00.000Z"),
        now,
      })
    ).toEqual({
      key: "expired",
      label: "已过期",
      tone: "warning",
      isExpired: true,
    });
  });

  it("formats expired scheduled trips for list displays", () => {
    expect(
      getTripDisplayStatus({
        status: "scheduled",
        targetArriveAt: new Date("2026-06-30T00:30:00.000Z"),
        now,
      })
    ).toMatchObject({
      key: "expired",
      label: "已过期",
      isExpired: true,
    });
  });
});
