import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPlannedTrip } from "@/lib/trips/create-trip";
import {
  createMemoryCandidateForTrip,
  replaceReminderSchedule,
  replaceTripRoute,
  selectRouteCandidate,
  updateTripSummary,
} from "@/lib/trips/route-updates";
import { ensureTestDatabase } from "./test-db";

describe("route update helpers", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("transactionally replaces a planned trip route, summary, buffers, candidates, and reminders", async () => {
    const user = await prisma.user.create({
      data: {
        email: `route-update-${Date.now()}@example.com`,
        name: "Route Update User",
        passwordHash: "hash",
      },
    });
    const targetArriveAt = new Date("2026-07-02T01:30:00.000Z");
    const replacementDepartAt = new Date("2026-07-02T00:55:00.000Z");
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Original commute.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      targetArriveAt,
      stops: [
        {
          order: 0,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 1,
          name: "Office",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 0,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Office",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 25,
          mode: "transit",
          bufferComponents: [
            {
              category: "transfer",
              label: "Original transfer",
              minutes: 5,
              reason: "Original route buffer.",
            },
          ],
        },
      ],
    });
    const original = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        stops: true,
        legs: { include: { routeCandidates: true, bufferComponents: true } },
        reminderJobs: true,
      },
    });

    await updateTripSummary({
      tripId: trip.id,
      userId: user.id,
      title: "Temporary title",
      finalStopName: "Temporary stop",
      status: "monitoring",
    });

    await replaceTripRoute({
      tripId: trip.id,
      userId: user.id,
      title: "Home-Gym",
      finalStopName: "Gym",
      targetArriveAt,
      stops: [
        {
          order: 0,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 1,
          name: "Cafe",
          lngLat: "121.15,29.15",
          kind: "waypoint",
          plannedStayMin: 10,
        },
        {
          order: 2,
          name: "Gym",
          lngLat: "121.3,29.3",
          kind: "destination",
          targetArriveAt,
        },
      ],
      legs: [
        {
          order: 0,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Cafe",
          destinationLngLat: "121.15,29.15",
          routeMinutes: 12,
          mode: "walking",
          routeTitle: "Walk to cafe",
          routeRationale: "Short walk is reliable.",
          segmentTitle: "Home to Cafe",
          segmentDetail: "Replacement first leg.",
          latestDepartAt: replacementDepartAt,
          bufferComponents: [
            {
              category: "venue",
              label: "Cafe pickup",
              minutes: 3,
              reason: "Pickup time.",
            },
          ],
        },
        {
          order: 1,
          originName: "Cafe",
          originLngLat: "121.15,29.15",
          destinationName: "Gym",
          destinationLngLat: "121.3,29.3",
          routeMinutes: 20,
          bufferMinutes: 4,
          totalMinutes: 24,
          mode: "bicycling",
          routeTitle: "Bike to gym",
          routeRationale: "Fastest revised option.",
          segmentTitle: "Cafe to Gym",
          segmentDetail: "Replacement final leg.",
          targetArriveAt,
          bufferComponents: [
            {
              category: "parking",
              label: "Bike parking",
              minutes: 4,
              reason: "Lock the bike.",
            },
            {
              category: "weather_context",
              label: "Weather reference",
              minutes: 8,
              reason: "Weather is context only.",
              source: "weather_context",
            },
          ],
        },
      ],
    });

    const updated = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        stops: { orderBy: { order: "asc" } },
        legs: {
          orderBy: { order: "asc" },
          include: {
            selectedCandidate: true,
            routeCandidates: true,
            routeSegments: { orderBy: { order: "asc" } },
            bufferComponents: { orderBy: { order: "asc" } },
            reminderJobs: true,
          },
        },
        reminderJobs: true,
      },
    });

    expect(updated).toMatchObject({
      title: "Home-Gym",
      finalStopName: "Gym",
      status: "monitoring",
      targetArriveAt,
    });
    expect(updated.stops.map((stop) => stop.name)).toEqual([
      "Home",
      "Cafe",
      "Gym",
    ]);
    expect(updated.stops.map((stop) => stop.id)).not.toEqual(
      original.stops.map((stop) => stop.id)
    );
    expect(updated.legs).toHaveLength(2);
    expect(
      updated.legs.map((leg) => ({
        from: updated.stops.find((stop) => stop.id === leg.fromStopId)?.name,
        to: updated.stops.find((stop) => stop.id === leg.toStopId)?.name,
      }))
    ).toEqual([
      { from: "Home", to: "Cafe" },
      { from: "Cafe", to: "Gym" },
    ]);
    expect(updated.legs.map((leg) => leg.destinationName)).toEqual([
      "Cafe",
      "Gym",
    ]);
    expect(updated.legs[1].selectedCandidate).toMatchObject({
      mode: "bicycling",
      routeMinutes: 20,
      bufferMinutes: 4,
      totalMinutes: 24,
      selected: true,
      title: "Bike to gym",
    });
    expect(
      updated.legs[1].bufferComponents.map((component) => ({
        category: component.category,
        minutes: component.minutes,
      }))
    ).toEqual([
      { category: "parking", minutes: 4 },
      { category: "weather_context", minutes: 0 },
    ]);
    for (const leg of updated.legs) {
      expect(leg.routeCandidates).toHaveLength(1);
      expect(leg.routeSegments).toHaveLength(1);
      expect(leg.reminderJobs).toHaveLength(6);
      expect(leg.reminderJobs.every((job) => job.status === "scheduled")).toBe(
        true
      );
    }
    expect(updated.reminderJobs).toHaveLength(12);
    expect(
      updated.reminderJobs.some((job) =>
        original.reminderJobs.some((oldJob) => oldJob.id === job.id)
      )
    ).toBe(false);
  });

  it("regenerates reminders by leg order when an agent sends a stale leg id after route replacement", async () => {
    const user = await prisma.user.create({
      data: {
        email: `route-stale-leg-${Date.now()}@example.com`,
        name: "Route Stale Leg User",
        passwordHash: "hash",
      },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Arrive at school by six.",
      timezone: "Asia/Shanghai",
      title: "Home-School",
      finalStopName: "School",
      targetArriveAt: new Date("2026-07-04T10:00:00.000Z"),
      stops: [
        {
          order: 1,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 2,
          name: "School",
          lngLat: "121.2,29.2",
          kind: "destination",
          targetArriveAt: new Date("2026-07-04T10:00:00.000Z"),
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "School",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 20,
          latestDepartAt: new Date("2026-07-04T09:30:00.000Z"),
          bufferComponents: [
            {
              category: "arrival",
              label: "Original arrival",
              minutes: 5,
              reason: "Original buffer.",
            },
          ],
        },
      ],
    });
    const originalLeg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id, order: 1 },
    });

    await replaceTripRoute({
      tripId: trip.id,
      userId: user.id,
      title: "Home-School",
      finalStopName: "School",
      targetArriveAt: new Date("2026-07-04T09:00:00.000Z"),
      stops: [
        {
          order: 1,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 2,
          name: "School",
          lngLat: "121.2,29.2",
          kind: "destination",
          targetArriveAt: new Date("2026-07-04T09:00:00.000Z"),
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "School",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 20,
          latestDepartAt: new Date("2026-07-04T08:30:00.000Z"),
          bufferComponents: [
            {
              category: "arrival",
              label: "Updated arrival",
              minutes: 5,
              reason: "Updated buffer.",
            },
          ],
        },
      ],
    });
    const currentLeg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id, order: 1 },
    });

    const reminders = await replaceReminderSchedule({
      tripId: trip.id,
      userId: user.id,
      legId: originalLeg.id,
      legOrder: 1,
      cadenceMinutes: [10, 0],
    });

    expect(currentLeg.id).not.toBe(originalLeg.id);
    expect(reminders).toHaveLength(2);
    expect(new Set(reminders.map((job) => job.legId))).toEqual(
      new Set([currentLeg.id])
    );
    expect(reminders.map((job) => job.scheduledFor)).toEqual([
      new Date("2026-07-04T08:20:00.000Z"),
      new Date("2026-07-04T08:30:00.000Z"),
    ]);
  });

  it("selects a replacement route candidate by key when an agent sends stale leg and candidate ids", async () => {
    const user = await prisma.user.create({
      data: {
        email: `route-stale-candidate-${Date.now()}@example.com`,
        name: "Route Stale Candidate User",
        passwordHash: "hash",
      },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Arrive at school by six.",
      timezone: "Asia/Shanghai",
      title: "Home-School",
      finalStopName: "School",
      stops: [
        {
          order: 1,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 2,
          name: "School",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "School",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 20,
          bufferComponents: [
            {
              category: "arrival",
              label: "Original arrival",
              minutes: 5,
              reason: "Original buffer.",
            },
          ],
        },
      ],
    });
    const originalLeg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id, order: 1 },
      include: { selectedCandidate: true },
    });

    await replaceTripRoute({
      tripId: trip.id,
      userId: user.id,
      title: "Home-School",
      finalStopName: "School",
      stops: [
        {
          order: 1,
          name: "Home",
          lngLat: "121.1,29.1",
          kind: "origin",
        },
        {
          order: 2,
          name: "School",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "School",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 18,
          routeTitle: "Updated route",
          bufferComponents: [
            {
              category: "arrival",
              label: "Updated arrival",
              minutes: 5,
              reason: "Updated buffer.",
            },
          ],
        },
      ],
    });
    const currentLeg = await prisma.tripLeg.findFirstOrThrow({
      where: { tripId: trip.id, order: 1 },
      include: { selectedCandidate: true },
    });

    const selected = await selectRouteCandidate({
      tripId: trip.id,
      userId: user.id,
      legId: originalLeg.id,
      legOrder: 1,
      candidateId: originalLeg.selectedCandidateId ?? undefined,
      candidateKey: "leg-1-selected",
    });

    expect(currentLeg.id).not.toBe(originalLeg.id);
    expect(currentLeg.selectedCandidateId).not.toBe(
      originalLeg.selectedCandidateId
    );
    expect(selected.id).toBe(currentLeg.selectedCandidateId);
    expect(selected.title).toBe("Updated route");
  });

  it("deduplicates and normalizes replacement reminder cadence minutes", async () => {
    const user = await prisma.user.create({
      data: {
        email: `route-cadence-${Date.now()}@example.com`,
        name: "Route Cadence User",
        passwordHash: "hash",
      },
    });
    const latestDepartAt = new Date("2026-07-03T01:00:00.000Z");
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Cadence commute.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      stops: [
        {
          order: 1,
          name: "Office",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Office",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 30,
          latestDepartAt,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });

    const reminders = await replaceReminderSchedule({
      tripId: trip.id,
      userId: user.id,
      cadenceMinutes: [10, 10, 0, 5.7],
    });

    expect(reminders).toHaveLength(3);
    expect(reminders.map((job) => JSON.parse(job.payloadJson))).toEqual([
      expect.objectContaining({ minutesBeforeDeparture: 10 }),
      expect.objectContaining({ minutesBeforeDeparture: 6 }),
      expect.objectContaining({ minutesBeforeDeparture: 0 }),
    ]);
    expect(new Set(reminders.map((job) => job.dedupeKey)).size).toBe(3);
  });

  it("rejects invalid reminder cadence and undefined memory candidate values clearly", async () => {
    const user = await prisma.user.create({
      data: {
        email: `route-invalid-${Date.now()}@example.com`,
        name: "Route Invalid User",
        passwordHash: "hash",
      },
    });
    const trip = await createPlannedTrip({
      userId: user.id,
      rawPrompt: "Invalid helper commute.",
      timezone: "Asia/Shanghai",
      title: "Home-Office",
      finalStopName: "Office",
      stops: [
        {
          order: 1,
          name: "Office",
          lngLat: "121.2,29.2",
          kind: "destination",
        },
      ],
      legs: [
        {
          order: 1,
          originName: "Home",
          originLngLat: "121.1,29.1",
          destinationName: "Office",
          destinationLngLat: "121.2,29.2",
          routeMinutes: 30,
          bufferComponents: [
            {
              category: "transfer",
              label: "Transfer",
              minutes: 5,
              reason: "Leave time for transfer.",
            },
          ],
        },
      ],
    });

    await expect(
      replaceReminderSchedule({
        tripId: trip.id,
        userId: user.id,
        cadenceMinutes: [10, -1],
      })
    ).rejects.toThrow(/cadence/i);
    await expect(
      createMemoryCandidateForTrip({
        tripId: trip.id,
        userId: user.id,
        kind: "preference",
        label: "Undefined memory",
        valueJson: undefined,
      })
    ).rejects.toThrow(/valueJson/i);
  });
});
