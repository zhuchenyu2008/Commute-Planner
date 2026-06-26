import { describe, expect, it } from "vitest";
import { chooseRouteOption, computeLatestDepartLocal } from "@/lib/planning/route-evaluator";

describe("route evaluator", () => {
  it("computes latest departure with buffers included", () => {
    const latest = computeLatestDepartLocal("2026-06-27 09:15", 45, "Asia/Shanghai");

    expect(latest).toBe("2026-06-27 08:30");
  });

  it("down-ranks direct bike in rainy weather unless it is the only route", () => {
    const chosen = chooseRouteOption(
      [
        { planKey: "bike_direct", routeType: "bike", totalMinutes: 30 },
        { planKey: "fastest", routeType: "transit", totalMinutes: 34 }
      ],
      { weatherText: "小雨", preferFastestEvenInBadWeather: false }
    );

    expect(chosen.planKey).toBe("fastest");
  });

  it("keeps a locked route during recheck selection", () => {
    const chosen = chooseRouteOption(
      [
        { planKey: "fastest", routeType: "transit", totalMinutes: 36 },
        { planKey: "bike_direct", routeType: "bike", totalMinutes: 28 }
      ],
      { lockedPlanKey: "fastest", weatherText: "晴" }
    );

    expect(chosen.planKey).toBe("fastest");
  });
});
