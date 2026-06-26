import { compareLocalStrings, diffLocalMinutes } from "@/lib/time/local-time";

export type RouteNotificationInput = {
  previousLatestDepartLocal?: string | null;
  nextLatestDepartLocal: string;
  thresholdMinutes: number;
  nowLocal: string;
};

export type RouteNotificationDecision = {
  shouldNotify: boolean;
  departNow: boolean;
  shiftMinutes: number | null;
};

export function shouldSendRouteNotification(input: RouteNotificationInput): RouteNotificationDecision {
  const departNow = compareLocalStrings(input.nowLocal, input.nextLatestDepartLocal) >= 0;
  const shiftMinutes = input.previousLatestDepartLocal
    ? diffLocalMinutes(input.nextLatestDepartLocal, input.previousLatestDepartLocal)
    : null;
  const materialShift = shiftMinutes === null || Math.abs(shiftMinutes) >= input.thresholdMinutes;

  return {
    shouldNotify: departNow || materialShift,
    departNow,
    shiftMinutes
  };
}
