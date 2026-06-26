import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { getProfile } from "@/lib/planning/planner";

export async function GET() {
  return withAuth(async () => {
    const profile = await getProfile();
    return apiOk(profile);
  });
}

export async function PATCH(request: Request) {
  return withAuth(async () => {
    const body = await request.json();
    const data: Prisma.ProfileUpdateInput = {
      city: String(body.city || ""),
      timezone: String(body.timezone || ""),
      defaultOriginName: String(body.defaultOriginName || ""),
      defaultOriginAddress: String(body.defaultOriginAddress || ""),
      defaultOriginLngLat: String(body.defaultOriginLngLat || ""),
      routePreferenceJson: body.routePreference ? JSON.stringify(body.routePreference) : undefined
    };
    if (body.insideVenueMinutes !== undefined) {
      data.insideVenueMinutes = Number(body.insideVenueMinutes);
    }
    if (body.waitAndFrictionMinutes !== undefined) {
      data.waitAndFrictionMinutes = Number(body.waitAndFrictionMinutes);
    }
    if (body.notifyThresholdMinutes !== undefined) {
      data.notifyThresholdMinutes = Number(body.notifyThresholdMinutes);
    }
    const profile = await prisma.profile.update({
      where: { id: "default" },
      data
    });
    return apiOk(profile);
  });
}
