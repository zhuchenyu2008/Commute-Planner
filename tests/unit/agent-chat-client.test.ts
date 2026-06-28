import { describe, expect, it } from "vitest";
import { createFallbackChatClient } from "@/lib/agent/chat-client";
import type { AgentChatMessage } from "@/lib/agent/chat-client";

describe("createFallbackChatClient", () => {
  it("does not invent a default origin when settings have no selected origin", async () => {
    const client = createFallbackChatClient();
    const messages: AgentChatMessage[] = [
      { role: "system", content: "test" },
      { role: "user", content: "plan commute" },
    ];

    const first = await client.complete({ messages, tools: [] });
    messages.push(first.message);
    messages.push({
      role: "tool",
      toolCallId: "mock-read-settings",
      content: JSON.stringify({
        defaultCity: "宁波",
        timezone: "Asia/Shanghai",
        originName: null,
        originLngLat: null,
        routePreference: "balanced",
      }),
    });

    const route = await client.complete({ messages, tools: [] });
    const routeCall = route.message.toolCalls?.find(
      (toolCall) => toolCall.name === "get_transit_route"
    );

    expect(routeCall?.arguments.origin).not.toBe("121.5230315924,29.8652491273");
    expect(routeCall?.arguments.origin).toBe("");

    messages.push(route.message);
    messages.push({
      role: "tool",
      toolCallId: "mock-route",
      content: JSON.stringify({ routeMinutes: 42 }),
    });

    const createTrip = await client.complete({ messages, tools: [] });
    const createTripCall = createTrip.message.toolCalls?.find(
      (toolCall) => toolCall.name === "create_trip"
    );
    const createTripArgs = createTripCall?.arguments as
      | { legs?: Array<{ originName?: unknown; originLngLat?: unknown }> }
      | undefined;

    expect(createTripArgs?.legs?.[0]?.originName).not.toBe("家");
    expect(createTripArgs?.legs?.[0]?.originName).toBe("");
    expect(createTripArgs?.legs?.[0]?.originLngLat).toBe("");
  });
});
