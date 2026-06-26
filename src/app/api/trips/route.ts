import { prisma } from "@/lib/db";
import { apiError, apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { serializeTrip } from "@/lib/trips/serialize";

export async function GET(request: Request) {
  return withAuth(async () => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const status = url.searchParams.get("status")?.split(",").filter(Boolean);
    const routeType = url.searchParams.get("routeType")?.split(",").filter(Boolean);
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const trips = await prisma.trip.findMany({
      where: {
        deletedAt: includeDeleted ? undefined : null,
        destinationName: q ? { contains: q } : undefined,
        status: status?.length ? { in: status } : undefined,
        routeType: routeType?.length ? { in: routeType } : undefined
      },
      orderBy: { createdAt: "desc" },
      include: { routeOptions: true, segments: true, reminderJobs: true }
    });
    return apiOk({ trips: trips.map(serializeTrip) });
  });
}

export async function DELETE() {
  return apiError("BAD_REQUEST", "请指定要删除的行程", 400);
}
