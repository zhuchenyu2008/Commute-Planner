import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) {
      return apiError("NOT_FOUND", "行程不存在", 404);
    }
    return apiOk({
      draftText: `明天 ${trip.arriveByLocal.slice(11)} 到${trip.destinationName}`,
      destinationText: trip.destinationName,
      routePreference: trip.routeType
    });
  });
}
