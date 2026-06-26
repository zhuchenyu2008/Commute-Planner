import { describe, expect, it } from "vitest";
import { parseArrivalRequest } from "@/lib/agent/time-parser";

describe("parseArrivalRequest", () => {
  it("parses tomorrow Chinese arrival requests in Asia/Shanghai", () => {
    const result = parseArrivalRequest("明天 9:15 到龙湖天街", {
      now: new Date("2026-06-26T02:00:00.000Z"),
      timezone: "Asia/Shanghai"
    });

    expect(result.destinationText).toBe("龙湖天街");
    expect(result.arriveByLocal).toBe("2026-06-27 09:15");
  });

  it("marks requested arrival time in the past", () => {
    const result = parseArrivalRequest("今天 9:15 到龙湖天街", {
      now: new Date("2026-06-26T04:00:00.000Z"),
      timezone: "Asia/Shanghai"
    });

    expect(result.isPast).toBe(true);
    expect(result.arriveByLocal).toBe("2026-06-26 09:15");
  });

  it("uses a default next-day morning arrival when time is missing", () => {
    const result = parseArrivalRequest("去学校", {
      now: new Date("2026-06-26T10:00:00.000Z"),
      timezone: "Asia/Shanghai"
    });

    expect(result.destinationText).toBe("学校");
    expect(result.arriveByLocal).toBe("2026-06-27 09:00");
  });
});
