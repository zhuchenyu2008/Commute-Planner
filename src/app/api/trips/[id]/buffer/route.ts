import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { recheckTrip } from "@/lib/planning/planner";
import { serializeTrip } from "@/lib/trips/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const body = await request.json();
    await prisma.trip.update({
      where: { id },
      data: {
        bufferJson: JSON.stringify({
          insideVenueMinutes: Number(body.insideVenueMinutes ?? 12),
          waitAndFrictionMinutes: Number(body.waitAndFrictionMinutes ?? 8)
        })
      }
    });
    const trip = await recheckTrip(id);
    return apiOk({ trip: serializeTrip(trip) });
  });
}
