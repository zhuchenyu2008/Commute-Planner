import { readEnv } from "@/lib/env";
import { createRealAmapClient } from "./client";
import { createMockAmapClient } from "./mock";
import { createAmapThrottle } from "./throttle";
import type { AmapClient } from "./types";

type EnvSource = Partial<Record<string, string | undefined>>;

type AmapClientFactoryOptions = {
  realClient?: AmapClient;
};

const withFallback = (realClient: AmapClient, mockClient: AmapClient): AmapClient => ({
  async searchPoi(request) {
    try {
      return await realClient.searchPoi(request);
    } catch {
      return mockClient.searchPoi(request);
    }
  },

  async getPoiDetail(request) {
    try {
      return await realClient.getPoiDetail(request);
    } catch {
      return mockClient.getPoiDetail(request);
    }
  },

  async getWeather(request) {
    try {
      return await realClient.getWeather(request);
    } catch {
      return mockClient.getWeather(request);
    }
  },

  async getTransitRoute(request) {
    try {
      return await realClient.getTransitRoute(request);
    } catch {
      return mockClient.getTransitRoute(request);
    }
  },

  async getWalkingRoute(request) {
    try {
      return await realClient.getWalkingRoute(request);
    } catch {
      return mockClient.getWalkingRoute(request);
    }
  },

  async getBicyclingRoute(request) {
    try {
      return await realClient.getBicyclingRoute(request);
    } catch {
      return mockClient.getBicyclingRoute(request);
    }
  }
});

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

  return withFallback(realClient, mockClient);
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
