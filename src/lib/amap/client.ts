import type {
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
import type { AmapThrottle } from "./throttle";

type AmapClientOptions = {
  apiKey: string;
  throttle: AmapThrottle;
  fetchImpl?: typeof fetch;
};

type AmapEnvelope = {
  status?: string;
  info?: string;
  infocode?: string;
  [key: string]: unknown;
};

type AmapBicyclingEnvelope = {
  errcode?: number | string;
  errmsg?: string;
  errdetail?: string;
  data?: {
    paths?: Array<{ duration?: string | number }>;
  };
  [key: string]: unknown;
};

type AmapPoi = {
  id?: string;
  name?: string;
  address?: string | unknown[];
  location?: string;
  [key: string]: unknown;
};

const BASE_URL = "https://restapi.amap.com/v3";
const BICYCLING_URL = "https://restapi.amap.com/v4/direction/bicycling";

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toPositiveMinutes = (seconds: unknown): number => {
  const durationSeconds = Number(seconds);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(durationSeconds / 60));
};

const formatAddress = (address: AmapPoi["address"]): string => {
  if (Array.isArray(address)) {
    return address.filter((value) => typeof value === "string").join(" ");
  }

  return typeof address === "string" ? address : "";
};

const formatRouteMode = (mode: RouteMode): string => {
  const labels: Record<RouteMode, string> = {
    bicycling: "骑行",
    transit: "公交/地铁",
    walking: "步行",
  };

  return labels[mode] ?? "通勤";
};

const toPoi = (poi: AmapPoi): Poi => ({
  id: poi.id ?? poi.name ?? "amap-poi",
  name: poi.name ?? "高德地点",
  address: formatAddress(poi.address),
  lngLat: poi.location ?? "0,0",
  raw: poi
});

export function createRealAmapClient(options: AmapClientOptions): AmapClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async <T extends AmapEnvelope>(
    url: string,
    params: Record<string, string | undefined>
  ): Promise<T> => {
    const searchParams = new URLSearchParams();
    searchParams.set("key", options.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value.trim().length > 0) {
        searchParams.set(key, value);
      }
    }

    return options.throttle.schedule(async () => {
      let response: Response;
      try {
        response = await fetchImpl(`${url}?${searchParams.toString()}`);
      } catch (error) {
        throw new Error(`高德请求失败：${getErrorMessage(error)}`);
      }

      if (!response.ok) {
        throw new Error(`高德 HTTP 请求失败：${response.status}`);
      }

      const data = (await response.json()) as T;

      if (data.status !== "1") {
        throw new Error(
          `高德返回状态失败：${data.info ?? "未知错误"} (${data.infocode ?? "无代码"})`
        );
      }

      return data;
    });
  };

  const requestBicycling = async (
    params: Record<string, string | undefined>
  ): Promise<AmapBicyclingEnvelope> => {
    const searchParams = new URLSearchParams();
    searchParams.set("key", options.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value.trim().length > 0) {
        searchParams.set(key, value);
      }
    }

    return options.throttle.schedule(async () => {
      let response: Response;
      try {
        response = await fetchImpl(`${BICYCLING_URL}?${searchParams.toString()}`);
      } catch (error) {
        throw new Error(`高德请求失败：${getErrorMessage(error)}`);
      }

      if (!response.ok) {
        throw new Error(`高德 HTTP 请求失败：${response.status}`);
      }

      const data = (await response.json()) as AmapBicyclingEnvelope;
      const errcode = String(data.errcode ?? "");

      if (errcode !== "0") {
        throw new Error(
          `高德骑行路线失败：${data.errmsg ?? data.errdetail ?? "未知错误"} (${errcode || "无代码"})`
        );
      }

      return data;
    });
  };

  const route = async (
    mode: RouteMode,
    url: string,
    requestBody: RouteRequest,
    extraParams: Record<string, string | undefined> = {}
  ): Promise<RouteResult> => {
    const data = await request<AmapEnvelope>(url, {
      origin: requestBody.origin,
      destination: requestBody.destination,
      city: requestBody.city,
      ...extraParams
    });

    return {
      mode,
      durationMinutes: extractRouteDurationMinutes(data),
      summary: `${formatRouteMode(mode)}路线来自高德`,
      raw: data
    };
  };

  return {
    async searchPoi(requestBody: PoiSearchRequest): Promise<Poi[]> {
      const data = await request<AmapEnvelope & { pois?: AmapPoi[] }>(
        `${BASE_URL}/place/text`,
        {
          keywords: requestBody.keywords,
          city: requestBody.city,
          output: "json"
        }
      );

      return (data.pois ?? []).map(toPoi);
    },

    async getPoiDetail({ id }: PoiDetailRequest): Promise<Poi> {
      const data = await request<AmapEnvelope & { pois?: AmapPoi[] }>(
        `${BASE_URL}/place/detail`,
        {
          id,
          output: "json"
        }
      );

      const poi = data.pois?.[0];

      if (!poi) {
        throw new Error(`未找到高德地点详情：${id}`);
      }

      return toPoi(poi);
    },

    async getWeather({ city }: WeatherRequest): Promise<WeatherReference> {
      const data = await request<
        AmapEnvelope & {
          lives?: Array<{
            city?: string;
            weather?: string;
            temperature?: string;
            winddirection?: string;
            windpower?: string;
          }>;
        }
      >(`${BASE_URL}/weather/weatherInfo`, {
        city,
        extensions: "base",
        output: "json"
      });

      const live = data.lives?.[0];
      const weatherCity = live?.city ?? city;
      const summaryParts = [
        live?.weather,
        live?.temperature ? `${live.temperature}°C` : undefined,
        live?.winddirection ? `${live.winddirection}风` : undefined,
        live?.windpower ? `${live.windpower}级` : undefined
      ].filter(Boolean);

      return {
        kind: "reference",
        city: weatherCity,
        summary: summaryParts.join(", ") || `${weatherCity} 暂无天气信息`,
        raw: data
      };
    },

    async getTransitRoute(requestBody: RouteRequest): Promise<RouteResult> {
      return route("transit", `${BASE_URL}/direction/transit/integrated`, requestBody, {
        city: requestBody.city,
        cityd: requestBody.cityd,
        output: "json"
      });
    },

    async getWalkingRoute(requestBody: RouteRequest): Promise<RouteResult> {
      return route("walking", `${BASE_URL}/direction/walking`, requestBody, {
        output: "json"
      });
    },

    async getBicyclingRoute(requestBody: RouteRequest): Promise<RouteResult> {
      const data = await requestBicycling({
        origin: requestBody.origin,
        destination: requestBody.destination
      });

      return {
        mode: "bicycling",
        durationMinutes: toPositiveMinutes(data.data?.paths?.[0]?.duration),
        summary: "骑行路线来自高德",
        raw: data
      };
    }
  };
}

function extractRouteDurationMinutes(data: AmapEnvelope): number {
  const route = data.route as
    | {
        paths?: Array<{ duration?: string | number }>;
        transits?: Array<{ duration?: string | number }>;
      }
    | undefined;

  return toPositiveMinutes(
    route?.paths?.[0]?.duration ?? route?.transits?.[0]?.duration
  );
}
