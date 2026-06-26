import { prisma } from "@/lib/db";
import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    await prisma.reminderJob.updateMany({
      where: { tripId: id, status: "pending" },
      data: { status: "cancelled" }
    });
    const trip = await prisma.trip.update({
      where: { id },
      data: { status: "cancelled" }
    });
    return apiOk({ trip });
  });
}
