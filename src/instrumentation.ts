export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRouteWatchScheduler } = await import("@/lib/scheduler/route-watch");
    startRouteWatchScheduler();
  }
}
