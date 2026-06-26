import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  reminderJob: {
    updateMany: vi.fn()
  },
  trip: {
    update: vi.fn()
  },
  profile: {
    update: vi.fn()
  }
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock
}));

vi.mock("@/lib/auth/api-guard", () => ({
  withAuth: (handler: () => Promise<Response>) => handler()
}));

describe("trip cancel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a serialized trip with relation arrays after cancelling reminders", async () => {
    prismaMock.reminderJob.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.trip.update.mockResolvedValue({
      id: "trip-1",
      destinationName: "龙湖天街",
      status: "cancelled",
      bufferJson: "{}",
      notificationJson: "{}",
      routeOptions: [{ id: "route-1", isChosen: true }],
      segments: [{ id: "segment-1" }],
      reminderJobs: [
        { id: "job-1", status: "cancelled" },
        { id: "job-2", status: "cancelled" }
      ]
    });

    const { POST } = await import("@/app/api/trips/[id]/cancel/route");
    const response = await POST(new Request("http://localhost/api/trips/trip-1/cancel"), {
      params: Promise.resolve({ id: "trip-1" })
    });
    const body = await response.json();

    expect(prismaMock.reminderJob.updateMany).toHaveBeenCalledWith({
      where: { tripId: "trip-1", status: "pending" },
      data: { status: "cancelled" }
    });
    expect(prismaMock.trip.update).toHaveBeenCalledWith({
      where: { id: "trip-1" },
      data: { status: "cancelled" },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    expect(Array.isArray(body.trip.routeOptions)).toBe(true);
    expect(Array.isArray(body.trip.segments)).toBe(true);
    expect(Array.isArray(body.trip.reminderJobs)).toBe(true);
    expect(body.trip.reminderJobs.every((job: { status: string }) => job.status === "cancelled")).toBe(true);
    expect(body.trip.buffer).toEqual({});
    expect(body.trip.notifications).toEqual({});
  });
});

describe("profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not overwrite automatic minute strategy fields when they are omitted", async () => {
    prismaMock.profile.update.mockResolvedValue({
      id: "default",
      city: "宁波",
      timezone: "Asia/Shanghai",
      defaultOriginName: "家",
      defaultOriginAddress: "金都嘉园52号",
      defaultOriginLngLat: "121.5230315924,29.8652491273",
      insideVenueMinutes: 12,
      waitAndFrictionMinutes: 8,
      notifyThresholdMinutes: 5
    });

    const { PATCH } = await import("@/app/api/profile/route");
    const response = await PATCH(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          city: "宁波",
          timezone: "Asia/Shanghai",
          defaultOriginName: "家",
          defaultOriginAddress: "金都嘉园52号",
          defaultOriginLngLat: "121.5230315924,29.8652491273"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(prismaMock.profile.update).toHaveBeenCalledWith({
      where: { id: "default" },
      data: {
        city: "宁波",
        timezone: "Asia/Shanghai",
        defaultOriginName: "家",
        defaultOriginAddress: "金都嘉园52号",
        defaultOriginLngLat: "121.5230315924,29.8652491273",
        routePreferenceJson: undefined
      }
    });
  });
});
