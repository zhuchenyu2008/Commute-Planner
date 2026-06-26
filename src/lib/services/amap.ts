import { env, hasAmapConfig } from "@/lib/env";

export type PoiResult = {
  name: string;
  address: string;
  location: string;
  city: string;
};

export type RouteDurationResult = {
  minutes: number;
  raw?: unknown;
};

export type WeatherResult = {
  text: string;
  temperature?: string;
  raw?: unknown;
};

const AMAP_BASE = "https://restapi.amap.com";

export class AmapService {
  async searchPoi(keyword: string, city = "宁波"): Promise<PoiResult> {
    if (!hasAmapConfig()) {
      return fallbackPoi(keyword, city);
    }
    const data = await amapGet("/v3/place/text", {
      keywords: keyword,
      city,
      citylimit: "true",
      offset: "1",
      page: "1",
      extensions: "all"
    });
    const poi = data.pois?.[0];
    if (!poi?.location) {
      throw new Error("没有找到目的地，请补充更明确的地点");
    }
    return {
      name: poi.name || keyword,
      address: poi.address || "",
      location: poi.location,
      city: poi.cityname || city
    };
  }

  async weather(city = "宁波"): Promise<WeatherResult> {
    if (!hasAmapConfig()) {
      return { text: "稍后有小雨", temperature: "24" };
    }
    const data = await amapGet("/v3/weather/weatherInfo", {
      city,
      extensions: "base"
    });
    const live = data.lives?.[0];
    if (!live) {
      return { text: "天气暂不可用" };
    }
    return {
      text: live.weather || "天气暂不可用",
      temperature: live.temperature,
      raw: live
    };
  }

  async transitDuration(origin: string, destination: string, city = "宁波", cityd = "宁波") {
    if (!hasAmapConfig()) {
      return { minutes: estimateFallbackMinutes(origin, destination, 34) };
    }
    const data = await amapGet("/v3/direction/transit/integrated", {
      origin,
      destination,
      city,
      cityd,
      strategy: "0"
    });
    const transits = data.route?.transits || [];
    const seconds = transits
      .map((item: { duration?: string }) => Number(item.duration || 0))
      .filter(Boolean)
      .sort((a: number, b: number) => a - b)[0];
    return { minutes: Math.max(1, Math.round((seconds || 0) / 60)), raw: data };
  }

  async bikeDuration(origin: string, destination: string) {
    if (!hasAmapConfig()) {
      return { minutes: estimateFallbackMinutes(origin, destination, 28) };
    }
    const data = await amapGet("/v4/direction/bicycling", {
      origin,
      destination
    });
    const seconds = Number(data.data?.paths?.[0]?.duration || 0);
    return { minutes: Math.max(1, Math.round((seconds || 0) / 60)), raw: data };
  }

  async walkingDuration(origin: string, destination: string) {
    if (!hasAmapConfig()) {
      return { minutes: estimateFallbackMinutes(origin, destination, 18) };
    }
    const data = await amapGet("/v3/direction/walking", {
      origin,
      destination
    });
    const seconds = Number(data.route?.paths?.[0]?.duration || 0);
    return { minutes: Math.max(1, Math.round((seconds || 0) / 60)), raw: data };
  }

  staticMapUrl(markers: string[], paths: string[] = []) {
    if (!hasAmapConfig()) {
      return "";
    }
    const params = new URLSearchParams({
      key: env.amapWebServiceKey,
      size: "560*360",
      scale: "2"
    });
    if (markers.length > 0) {
      params.set("markers", markers.join(";"));
    }
    if (paths.length > 0) {
      params.set("paths", paths.join(";"));
    }
    return `${AMAP_BASE}/v3/staticmap?${params.toString()}`;
  }
}

async function amapGet(path: string, params: Record<string, string>) {
  const url = new URL(path, AMAP_BASE);
  url.searchParams.set("key", env.amapWebServiceKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("高德服务暂不可用");
  }
  const data = await response.json();
  if (data.status && data.status !== "1") {
    throw new Error(data.info || "高德服务返回失败");
  }
  return data;
}

function fallbackPoi(keyword: string, city: string): PoiResult {
  const known: Record<string, PoiResult> = {
    学校: {
      name: "宁波外事学校（启运路校区）",
      address: "启运路",
      location: "121.531320,29.871117",
      city
    },
    龙湖天街: {
      name: "龙湖天街",
      address: "宁波龙湖天街",
      location: "121.590364,29.880799",
      city
    }
  };
  return (
    known[keyword] || {
      name: keyword,
      address: `${city}${keyword}`,
      location: "121.590364,29.880799",
      city
    }
  );
}

function estimateFallbackMinutes(_origin: string, destination: string, base: number) {
  const signature = destination
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return base + (signature % 7);
}

export const amapService = new AmapService();
