import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeTrip } from "@/lib/trips/serialize";

export async function GET() {
  return withAuth(async () => {
    const trip = await prisma.trip.findFirst({
      where: { status: { in: ["active", "scheduled"] }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    return apiOk({ trip: trip ? serializeTrip(trip) : null });
  });
}
