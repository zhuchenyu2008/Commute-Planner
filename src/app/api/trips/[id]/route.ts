import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeTrip } from "@/lib/trips/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    if (!trip || trip.deletedAt) {
      return apiError("NOT_FOUND", "行程不存在", 404);
    }
    return apiOk({ trip: serializeTrip(trip) });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) {
      return apiError("NOT_FOUND", "行程不存在", 404);
    }
    if (trip.status === "active") {
      return apiError("BAD_REQUEST", "活跃行程需要先停止监控", 400);
    }
    await prisma.trip.update({
      where: { id },
      data: { status: "deleted", deletedAt: new Date() }
    });
    return apiOk({ ok: true });
  });
}
