import { describe, expect, it } from "vitest";
import {
  formatHomeTripStatus,
  formatHistoryTripSummary,
  formatLatestMemorySummary,
} from "@/lib/home/summary";

describe("home summary helpers", () => {
  it("formats the latest trip status for the realtime card", () => {
    expect(
      formatHomeTripStatus({
        status: "monitoring",
        finalStopName: "宁波外事学校",
        targetArriveAt: new Date("2026-06-29T09:00:00.000Z"),
      }, new Date("2026-06-29T08:00:00.000Z"))
    ).toEqual({
      label: "监控中",
      tone: "success",
      title: "宁波外事学校",
      description: "目标到达 17:00",
    });
  });

  it("formats recent history trip state", () => {
    expect(
      formatHistoryTripSummary({
        title: "家到图书馆",
        status: "completed",
        finalStopName: "图书馆",
      })
    ).toEqual("已完成 · 图书馆");
  });

  it("marks stale monitoring trips as expired in recent history summaries", () => {
    expect(
      formatHistoryTripSummary(
        {
          title: "家到东钱湖",
          status: "monitoring",
          finalStopName: "东钱湖地铁站",
          targetArriveAt: new Date("2026-06-30T00:30:00.000Z"),
        },
        new Date("2026-06-30T01:00:00.000Z")
      )
    ).toEqual("已过期 · 东钱湖地铁站");
  });

  it("marks stale monitoring trips as expired on the home card", () => {
    expect(
      formatHomeTripStatus(
        {
          status: "monitoring",
          finalStopName: "东钱湖地铁站",
          targetArriveAt: new Date("2026-06-30T00:30:00.000Z"),
        },
        new Date("2026-06-30T01:00:00.000Z")
      )
    ).toMatchObject({
      label: "已过期",
      tone: "warning",
      title: "东钱湖地铁站",
    });
  });

  it("formats the latest memory with fallback text", () => {
    expect(
      formatLatestMemorySummary({
        kind: "preference",
        label: "下雨天优先公交",
      })
    ).toBe("偏好 · 下雨天优先公交");

    expect(formatLatestMemorySummary(null)).toBe("暂无已确认记忆");
  });
});
