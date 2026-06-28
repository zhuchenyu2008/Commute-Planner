import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import { ensureTestDatabase } from "./test-db";

describe("createPlannedTrip", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("persists ordered multi-stop trips with routes, buffers, and reminders", async () => {
    const user = await prisma.user.create({
      data: {
        email: `trip-${Date.now()}@example.com`,
        name: "Trip Planner",
        passwordHash: "hash",
      },
    });

    const targetArriveAt = new Date("2026-07-01T10:00:00.000Z");
    const latestDepartAt = new Date("2026-07-01T09:10:00.000Z");

    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Leave home, pick up coffee, then go to the office.",
      timezone: "Asia/Shanghai",
      title: "Morning office run",
      targetArriveAt,
      stops: [
        {
          name: "Home",
          lngLat: "121.500000,31.200000",
          kind: "origin",
        },
        {
          name: "Coffee Shop",
          address: "88 Bean Street",
          lngLat: "121.510000,31.210000",
          plannedStayMin: 5,
          kind: "waypoint",
        },
        {
          name: "Office",
          lngLat: "121.520000,31.220000",
          targetArriveAt,
          kind: "destination",
        },
      ],
      legs: [
        {
          routeMinutes: 18,
          latestDepartAt,
          mode: "driving",
          routeTitle: "Drive to coffee",
          segmentTitle: "Home to coffee",
        },
        {
          routeMinutes: 20,
          mode: "walking",
          routeTitle: "Walk to office",
          segmentTitle: "Coffee to office",
        },
      ],
    });

    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        stops: { orderBy: { order: "asc" } },
        legs: {
          orderBy: { order: "asc" },
          include: {
            routeCandidates: true,
            routeSegments: true,
            bufferComponents: { orderBy: { order: "asc" } },
            reminderJobs: { orderBy: { scheduledFor: "asc" } },
            selectedCandidate: true,
          },
        },
        reminderJobs: true,
      },
    });

    expect(persisted).toMatchObject({
      userId: user.id,
      title: "Morning office run",
      rawPrompt: "Leave home, pick up coffee, then go to the office.",
      status: "monitoring",
      timezone: "Asia/Shanghai",
      finalStopName: "Office",
    });
    expect(persisted.stops.map((stop) => stop.name)).toEqual([
      "Home",
      "Coffee Shop",
      "Office",
    ]);
    expect(persisted.stops.map((stop) => stop.order)).toEqual([0, 1, 2]);

    expect(persisted.legs).toHaveLength(2);
    expect(persisted.legs[0]).toMatchObject({
      order: 0,
      fromStopId: persisted.stops[0].id,
      toStopId: persisted.stops[1].id,
      originName: "Home",
      destinationName: "Coffee Shop",
      latestDepartAt,
      status: "monitoring",
    });
    expect(persisted.legs[1]).toMatchObject({
      order: 1,
      fromStopId: persisted.stops[1].id,
      toStopId: persisted.stops[2].id,
      originName: "Coffee Shop",
      destinationName: "Office",
      status: "monitoring",
    });
    expect(persisted.legs[1].latestDepartAt).toBeInstanceOf(Date);

    for (const leg of persisted.legs) {
      expect(leg.routeCandidates).toHaveLength(1);
      expect(leg.selectedCandidateId).toBe(leg.routeCandidates[0].id);
      expect(leg.selectedCandidate).toMatchObject({
        id: leg.routeCandidates[0].id,
        selected: true,
      });
      expect(leg.routeSegments).toHaveLength(1);
      expect(leg.routeSegments[0]).toMatchObject({
        legId: leg.id,
        candidateId: leg.routeCandidates[0].id,
      });
      expect(leg.bufferComponents.map((component) => component.category)).toEqual([
        "venue",
        "transfer",
        "weather_context",
      ]);
      expect(
        leg.bufferComponents.find(
          (component) => component.category === "weather_context"
        )?.minutes
      ).toBe(0);
      expect(leg.reminderJobs.map((job) => job.kind)).toEqual([
        "recheck",
        "recheck",
        "recheck",
        "recheck",
        "recheck",
        "depart_now",
      ]);
    }

    expect(persisted.reminderJobs).toHaveLength(12);
  });

  it("accepts destination stops with explicit leg endpoints", async () => {
    const user = await prisma.user.create({
      data: {
        email: `trip-agent-shape-${Date.now()}@example.com`,
        name: "Trip Agent Shape",
        passwordHash: "hash",
      },
    });

    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Tomorrow 9:15 arrive at Longhu Tianjie",
      timezone: "Asia/Shanghai",
      title: "Longhu Tianjie",
      stops: [
        {
          order: 1,
          name: "Longhu Tianjie",
          lngLat: "121.616000,29.868000",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.5230315924,29.8652491273",
          destinationName: "Longhu Tianjie",
          destinationLngLat: "121.616000,29.868000",
          routeMinutes: 36,
          bufferMinutes: 15,
          totalMinutes: 51,
          latestDepartAt: new Date("2026-07-01T00:24:00.000Z"),
        },
      ],
    });

    const persisted = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        stops: true,
        legs: {
          include: {
            routeCandidates: true,
            bufferComponents: true,
            reminderJobs: true,
          },
        },
      },
    });

    expect(persisted.stops).toHaveLength(1);
    expect(persisted.legs).toHaveLength(1);
    expect(persisted.legs[0]).toMatchObject({
      order: 1,
      fromStopId: null,
      toStopId: persisted.stops[0].id,
      originName: "Home",
      originLngLat: "121.5230315924,29.8652491273",
      destinationName: "Longhu Tianjie",
      destinationLngLat: "121.616000,29.868000",
    });
    expect(persisted.legs[0].routeCandidates[0]).toMatchObject({
      routeMinutes: 36,
      bufferMinutes: 15,
      totalMinutes: 51,
    });
    expect(
      persisted.legs[0].bufferComponents.find(
        (component) => component.category === "weather_context"
      )?.minutes
    ).toBe(0);
    expect(persisted.legs[0].reminderJobs).toHaveLength(6);
  });
});
