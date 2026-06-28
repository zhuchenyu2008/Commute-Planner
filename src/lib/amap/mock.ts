import type {
  AmapClient,
  Poi,
  PoiSearchRequest,
  RouteRequest,
  RouteResult,
  WeatherRequest,
  WeatherReference
} from "./types";

const mockPoi: Poi = {
  id: "mock-longhu-tianjie",
  name: "宁波龙湖天街",
  address: "浙江省宁波市龙湖天街",
  lngLat: "121.616,29.868",
  raw: {
    source: "mock"
  }
};

const clonePoi = (poi: Poi): Poi => ({
  ...poi,
  raw: poi.raw
});

const formatRouteMode = (mode: RouteResult["mode"]) => {
  const labels: Record<RouteResult["mode"], string> = {
    bicycling: "骑行",
    transit: "公交/地铁",
    walking: "步行",
  };

  return labels[mode] ?? "通勤";
};

const createRoute = (
  request: RouteRequest,
  mode: RouteResult["mode"],
  durationMinutes: number
): RouteResult => ({
  mode,
  durationMinutes,
  summary: `${formatRouteMode(mode)}路线：${request.origin} 到 ${request.destination}`,
  raw: {
    source: "mock",
    request: { ...request }
  }
});

export function createMockAmapClient(): AmapClient {
  return {
    async searchPoi(request: PoiSearchRequest): Promise<Poi[]> {
      return [
        {
          ...clonePoi(mockPoi),
          raw: {
            source: "mock",
            request: { ...request }
          }
        }
      ];
    },

    async getPoiDetail({ id }: { id: string }): Promise<Poi> {
      return {
        ...clonePoi(mockPoi),
        id,
        raw: {
          source: "mock",
          id
        }
      };
    },

    async getWeather({ city }: WeatherRequest): Promise<WeatherReference> {
      return {
        kind: "reference",
        city,
        summary: `${city} 天气参考：晴，温和，仅作通勤参考。`,
        raw: {
          source: "mock",
          city
        }
      };
    },

    async getTransitRoute(request: RouteRequest): Promise<RouteResult> {
      return createRoute(request, "transit", 42);
    },

    async getWalkingRoute(request: RouteRequest): Promise<RouteResult> {
      return createRoute(request, "walking", 58);
    },

    async getBicyclingRoute(request: RouteRequest): Promise<RouteResult> {
      return createRoute(request, "bicycling", 24);
    }
  };
}
