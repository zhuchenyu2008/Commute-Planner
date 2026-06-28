import { describe, expect, it } from "vitest";
import { normalizeBufferComponents } from "@/lib/trips/buffers";

describe("normalizeBufferComponents", () => {
  it("keeps weather context as a zero-minute reference buffer", () => {
    const components = normalizeBufferComponents([
      {
        category: "weather_context",
        label: "附近有大雨",
        minutes: 12.7,
        reason: "雨势只影响监控参考，不增加固定缓冲。",
        source: "weather_context",
      },
      {
        category: "venue",
        label: "大厅换乘",
        minutes: 4.4,
        reason: "楼内短距离步行。",
        source: "agent_inference",
      },
    ]);

    expect(components).toEqual([
      {
        order: 0,
        category: "weather_context",
        label: "附近有大雨",
        minutes: 0,
        reason: "雨势只影响监控参考，不增加固定缓冲。",
        source: "weather_context",
      },
      {
        order: 1,
        category: "venue",
        label: "大厅换乘",
        minutes: 4,
        reason: "楼内短距离步行。",
        source: "agent_inference",
      },
    ]);
  });
});
