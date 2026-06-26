import { describe, expect, it } from "vitest";
import { shouldSendRouteNotification } from "@/lib/notifications/policy";

describe("notification policy", () => {
  it("does not notify when latest depart shift is below threshold", () => {
    const decision = shouldSendRouteNotification({
      previousLatestDepartLocal: "2026-06-27 08:30",
      nextLatestDepartLocal: "2026-06-27 08:33",
      thresholdMinutes: 5,
      nowLocal: "2026-06-27 08:00"
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.shiftMinutes).toBe(3);
  });

  it("notifies when latest depart shift reaches threshold", () => {
    const decision = shouldSendRouteNotification({
      previousLatestDepartLocal: "2026-06-27 08:30",
      nextLatestDepartLocal: "2026-06-27 08:24",
      thresholdMinutes: 5,
      nowLocal: "2026-06-27 08:00"
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.shiftMinutes).toBe(-6);
  });

  it("notifies when it is time to depart even without a material shift", () => {
    const decision = shouldSendRouteNotification({
      previousLatestDepartLocal: "2026-06-27 08:30",
      nextLatestDepartLocal: "2026-06-27 08:30",
      thresholdMinutes: 5,
      nowLocal: "2026-06-27 08:30"
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.departNow).toBe(true);
  });
});
