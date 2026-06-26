import { apiError } from "@/lib/http/api";
import { requireSession, UnauthorizedError } from "@/lib/auth/session";

export async function withAuth<T>(handler: () => Promise<T>) {
  try {
    await requireSession();
    return await handler();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError("UNAUTHORIZED", error.message, 401);
    }
    throw error;
  }
}
