import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeTrip } from "@/lib/trips/serialize";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    await prisma.reminderJob.updateMany({
      where: { tripId: id, status: "pending" },
      data: { status: "cancelled" }
    });
    const trip = await prisma.trip.update({
      where: { id },
      data: { status: "cancelled" },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    return apiOk({ trip: serializeTrip(trip) });
  });
}
