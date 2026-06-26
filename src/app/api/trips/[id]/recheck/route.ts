import { apiOk } from "@/lib/http/api";
import { withAuth } from "@/lib/auth/api-guard";
import { recheckTrip } from "@/lib/planning/planner";
import { serializeTrip } from "@/lib/trips/serialize";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withAuth(async () => {
    const { id } = await context.params;
    const trip = await recheckTrip(id);
    return apiOk({ trip: serializeTrip(trip) });
  });
}
