import { addMinutesToLocalString } from "@/lib/time/local-time";

export type RouteChoiceInput = {
  planKey: string;
  routeType: string;
  totalMinutes: number;
};

export type RouteChoiceOptions = {
  weatherText?: string | null;
  lockedPlanKey?: string | null;
  preferFastestEvenInBadWeather?: boolean;
};

export function computeLatestDepartLocal(
  arriveByLocal: string,
  totalMinutes: number,
  _timezone = "Asia/Shanghai"
) {
  return addMinutesToLocalString(arriveByLocal, -totalMinutes);
}

export function chooseRouteOption<T extends RouteChoiceInput>(
  options: T[],
  choiceOptions: RouteChoiceOptions = {}
): T {
  if (options.length === 0) {
    throw new Error("No route options available");
  }

  if (choiceOptions.lockedPlanKey) {
    const locked = options.find((option) => option.planKey === choiceOptions.lockedPlanKey);
    if (locked) {
      return locked;
    }
  }

  const badBikeWeather = isBadBikeWeather(choiceOptions.weatherText);
  const scored = options.map((option) => ({
    option,
    score:
      option.totalMinutes +
      (badBikeWeather && option.routeType === "bike" && !choiceOptions.preferFastestEvenInBadWeather ? 10 : 0)
  }));
  scored.sort((a, b) => a.score - b.score || a.option.totalMinutes - b.option.totalMinutes);
  return scored[0].option;
}

export function isBadBikeWeather(weatherText?: string | null) {
  if (!weatherText) {
    return false;
  }
  return /雨|雪|风|霾|雾|冻|雷|暴|台风/.test(weatherText);
}
