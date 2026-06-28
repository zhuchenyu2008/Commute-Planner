import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  runPlanningSession,
  startPlanningSession,
} from "@/lib/agent/planner";
import { ensureTestDatabase } from "./test-db";

describe("agent planning sessions", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("starts a visible running session with the initial user message", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agent-start-${Date.now()}@example.com`,
        name: "Agent Starter",
        passwordHash: "hash",
      },
    });

    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Plan my commute to Longhu Tianjie tomorrow morning.",
    });

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { messages: true },
    });

    expect(persisted).toMatchObject({
      userId: user.id,
      status: "running",
      purpose: "planning",
      prompt: "Plan my commute to Longhu Tianjie tomorrow morning.",
      retryCount: 0,
      timeoutMs: 600000,
      tripId: null,
    });
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0]).toMatchObject({
      role: "user",
      content: "Plan my commute to Longhu Tianjie tomorrow morning.",
    });
  });

  it("runs a planning session into a completed trip with tool logs and messages", async () => {
    const user = await prisma.user.create({
      data: {
        email: `agent-run-${Date.now()}@example.com`,
        name: "Agent Runner",
        passwordHash: "hash",
        settings: {
          create: {
            defaultCity: "Ningbo",
            timezone: "Asia/Shanghai",
            originName: "Home",
            originLngLat: "121.5230315924,29.8652491273",
            routePreference: "balanced",
          },
        },
      },
    });

    const session = await startPlanningSession({
      userId: user.id,
      prompt: "Tomorrow 9:15 arrive at Longhu Tianjie after coffee",
    });

    const result = await runPlanningSession(session.id);

    expect(result.status).toBe("completed");
    expect(result.tripId).toEqual(expect.any(String));

    const persisted = await prisma.agentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        toolCalls: { orderBy: { createdAt: "asc" } },
        trip: {
          include: {
            stops: { orderBy: { order: "asc" } },
            legs: {
              orderBy: { order: "asc" },
              include: {
                bufferComponents: { orderBy: { order: "asc" } },
                routeCandidates: true,
              },
            },
          },
        },
      },
    });

    expect(persisted.status).toBe("completed");
    expect(persisted.tripId).toBe(result.tripId);
    expect(persisted.retryCount).toBe(0);
    expect(persisted.messages.map((message) => message.role)).toContain("assistant");
    expect(
      persisted.messages.some((message) =>
        message.content.includes("Weather is reference context")
      )
    ).toBe(true);

    expect(persisted.toolCalls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        "search_poi",
        "get_weather_reference",
        "get_transit_route",
      ])
    );
    for (const call of persisted.toolCalls) {
      expect(call.status).toBe("completed");
      expect(call.requestJson).toBeTruthy();
      expect(call.responseJson).toBeTruthy();
      expect(call.durationMs).toEqual(expect.any(Number));
    }

    expect(persisted.trip).toBeTruthy();
    expect(persisted.trip?.status).toBe("monitoring");
    expect(persisted.trip?.agentSessionId).toBe(session.id);
    expect(persisted.trip?.stops).toHaveLength(1);
    expect(persisted.trip?.stops[0]).toMatchObject({
      order: 1,
      name: "Longhu Tianjie Ningbo",
      kind: "destination",
    });
    expect(persisted.trip?.legs).toHaveLength(1);
    expect(persisted.trip?.legs[0]).toMatchObject({
      order: 1,
      originName: "Home",
      originLngLat: "121.5230315924,29.8652491273",
      destinationName: "Longhu Tianjie Ningbo",
    });
    expect(
      persisted.trip?.legs[0].bufferComponents.map(
        (component) => component.category
      )
    ).toEqual(["venue", "transfer", "weather_context"]);
    expect(
      persisted.trip?.legs[0].bufferComponents.find(
        (component) => component.category === "weather_context"
      )
    ).toMatchObject({
      minutes: 0,
      source: "weather_context",
    });
  });
});
