import { describe, expect, it } from "vitest";
import { normalizeBufferComponents } from "@/lib/trips/buffers";

describe("normalizeBufferComponents", () => {
  it("keeps weather context as a zero-minute reference buffer", () => {
    const components = normalizeBufferComponents([
      {
        category: "weather_context",
        label: "Heavy rain nearby",
        minutes: 12.7,
        reason: "Rain should inform monitoring without fixed padding.",
        source: "weather_context",
      },
      {
        category: "venue",
        label: "Lobby transfer",
        minutes: 4.4,
        reason: "Short walk inside the building.",
        source: "agent_inference",
      },
    ]);

    expect(components).toEqual([
      {
        order: 0,
        category: "weather_context",
        label: "Heavy rain nearby",
        minutes: 0,
        reason: "Rain should inform monitoring without fixed padding.",
        source: "weather_context",
      },
      {
        order: 1,
        category: "venue",
        label: "Lobby transfer",
        minutes: 4,
        reason: "Short walk inside the building.",
        source: "agent_inference",
      },
    ]);
  });
});
