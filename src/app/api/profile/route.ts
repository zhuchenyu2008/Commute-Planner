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
    const profile = await prisma.profile.update({
      where: { id: "default" },
      data: {
        city: body.city,
        timezone: body.timezone,
        defaultOriginName: body.defaultOriginName,
        defaultOriginAddress: body.defaultOriginAddress,
        defaultOriginLngLat: body.defaultOriginLngLat,
        insideVenueMinutes: Number(body.insideVenueMinutes ?? undefined),
        waitAndFrictionMinutes: Number(body.waitAndFrictionMinutes ?? undefined),
        notifyThresholdMinutes: Number(body.notifyThresholdMinutes ?? undefined),
        routePreferenceJson: body.routePreference ? JSON.stringify(body.routePreference) : undefined
      }
    });
    return apiOk(profile);
  });
}
