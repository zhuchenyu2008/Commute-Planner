import { readEnv } from "@/lib/env";
import { createRealAmapClient } from "./client";
import { createMockAmapClient } from "./mock";
import { createAmapThrottle } from "./throttle";
import type { AmapClient } from "./types";

type EnvSource = Partial<Record<string, string | undefined>>;

type AmapClientFactoryOptions = {
  realClient?: AmapClient;
};

export function createAmapClient(
  source: EnvSource = process.env,
  options: AmapClientFactoryOptions = {}
): AmapClient {
  const env = readEnv(source);
  const mockClient = createMockAmapClient();

  if (!env.hasAmapKey) {
    return mockClient;
  }

  const apiKey = source.AMAP_API_KEY?.trim();

  if (!apiKey) {
    return mockClient;
  }

  const realClient =
    options.realClient ??
    createRealAmapClient({
      apiKey,
      throttle: createAmapThrottle({ requestsPerSecond: 3 })
    });

  return realClient;
}

export { createRealAmapClient } from "./client";
export { createMockAmapClient } from "./mock";
export { createAmapThrottle } from "./throttle";
export type {
  AmapClient,
  Poi,
  PoiDetailRequest,
  PoiSearchRequest,
  RouteMode,
  RouteRequest,
  RouteResult,
  WeatherRequest,
  WeatherReference
} from "./types";
