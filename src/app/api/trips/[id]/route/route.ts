import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeTrip } from "@/lib/trips/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const body = await request.json();
    const chosenPlanKey = String(body.chosenPlanKey || "");
    const option = await prisma.tripRouteOption.findFirst({ where: { tripId: id, planKey: chosenPlanKey } });
    if (!option) {
      return apiError("NOT_FOUND", "候选路线不存在", 404);
    }
    await prisma.tripRouteOption.updateMany({ where: { tripId: id }, data: { isChosen: false } });
    await prisma.tripRouteOption.update({ where: { id: option.id }, data: { isChosen: true } });
    const trip = await prisma.trip.update({
      where: { id },
      data: {
        chosenPlanKey,
        latestDepartLocal: option.latestDepartLocal,
        totalMinutes: option.totalMinutes,
        routeType: option.routeType
      },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    return apiOk({ trip: serializeTrip(trip) });
  });
}
