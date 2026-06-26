import { prisma } from "@/lib/db";
import { amapService } from "@/lib/services/amap";
import { parseTripMessage } from "@/lib/services/openai-agent";
import { chooseRouteOption, computeLatestDepartLocal } from "@/lib/planning/route-evaluator";
import { addMinutesToLocalString, parseLocalDateTime } from "@/lib/time/local-time";

export type TripPlanningResult = {
  message: string;
  tripId: string | null;
  pendingMemoryCount: number;
  state: "planned" | "pastArrivalTime";
};

type BuiltRouteOption = {
  planKey: string;
  title: string;
  routeType: string;
  baseMinutes: number;
  bufferMinutes: number;
  totalMinutes: number;
  latestDepartLocal: string;
  breakdown: Array<{ mode: string; title: string; detail: string; minutes: number }>;
  raw?: unknown;
};

const HABIT_STATIONS = [
  ["柳西", "121.531320,29.871117"],
  ["丽园南路", "121.517716,29.858133"],
  ["云霞路", "121.526364,29.858542"]
] as const;

export async function planTripFromText(text: string): Promise<TripPlanningResult> {
  const profile = await getProfile();
  const parsed = await parseTripMessage(text, profile.timezone);
  if (parsed.isPast) {
    return {
      message: `你要到达的时间 ${parsed.arriveByLocal} 已经过了，请确认新的到达时间。`,
      tripId: null,
      pendingMemoryCount: 0,
      state: "pastArrivalTime"
    };
  }

  const poi = await amapService.searchPoi(parsed.destinationText, profile.city);
  const weather = await amapService.weather(profile.city);
  const routeOptions = await buildRouteOptions({
    origin: profile.defaultOriginLngLat,
    destination: poi.location,
    city: profile.city,
    cityd: profile.city,
    arriveByLocal: parsed.arriveByLocal,
    insideVenueMinutes: profile.insideVenueMinutes,
    waitAndFrictionMinutes: profile.waitAndFrictionMinutes
  });
  const chosen = chooseRouteOption(routeOptions, { weatherText: weather.text });
  const mapImageUrl = amapService.staticMapUrl([`mid,,A:${profile.defaultOriginLngLat}`, `mid,,B:${poi.location}`]);

  const trip = await prisma.trip.create({
    data: {
      destinationName: poi.name,
      destinationAddress: poi.address,
      destinationLngLat: poi.location,
      originName: profile.defaultOriginName,
      originLngLat: profile.defaultOriginLngLat,
      city: profile.city,
      timezone: profile.timezone,
      arriveByLocal: parsed.arriveByLocal,
      latestDepartLocal: chosen.latestDepartLocal,
      estimatedArriveLocal: parsed.arriveByLocal,
      totalMinutes: chosen.totalMinutes,
      routeType: chosen.routeType,
      chosenPlanKey: chosen.planKey,
      mapImageUrl,
      bufferJson: JSON.stringify({
        insideVenueMinutes: profile.insideVenueMinutes,
        waitAndFrictionMinutes: profile.waitAndFrictionMinutes
      }),
      notificationJson: JSON.stringify({
        weather: weather.text,
        weatherTemperature: weather.temperature
      }),
      routeOptions: {
        create: routeOptions.map((option, index) => ({
          planKey: option.planKey,
          title: option.title,
          routeType: option.routeType,
          baseMinutes: option.baseMinutes,
          bufferMinutes: option.bufferMinutes,
          totalMinutes: option.totalMinutes,
          latestDepartLocal: option.latestDepartLocal,
          isChosen: option.planKey === chosen.planKey,
          sortOrder: index,
          rawJson: JSON.stringify(option.raw || {})
        }))
      },
      segments: {
        create: chosen.breakdown.map((segment, index) => ({
          ...segment,
          sortOrder: index
        }))
      },
      reminderJobs: {
        create: buildReminderJobs(chosen.latestDepartLocal, profile.timezone).map((job) => ({
          kind: "route-watch",
          scheduledAt: job.scheduledAt,
          offsetMinutes: job.offsetMinutes
        }))
      }
    }
  });

  await createPendingMemoryFromMessage(text, poi.name);

  const pendingMemoryCount = await prisma.memory.count({ where: { status: "pending" } });
  return {
    message: `已为你规划好路线，最晚 ${chosen.latestDepartLocal.slice(11)} 出发。`,
    tripId: trip.id,
    pendingMemoryCount,
    state: "planned"
  };
}

export async function recheckTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { routeOptions: true }
  });
  if (!trip) {
    throw new Error("行程不存在");
  }
  const chosen =
    trip.routeOptions.find((option: { planKey: string }) => option.planKey === trip.chosenPlanKey) ||
    trip.routeOptions[0];
  if (!chosen) {
    throw new Error("行程缺少锁定路线");
  }
  const weather = await amapService.weather(trip.city);
  const latestDepartLocal = computeLatestDepartLocal(trip.arriveByLocal, chosen.totalMinutes, trip.timezone);
  const updated = await prisma.trip.update({
    where: { id: trip.id },
    data: {
      latestDepartLocal,
      notificationJson: JSON.stringify({
        ...safeJson(trip.notificationJson),
        weather: weather.text,
        lastRecheckedAt: new Date().toISOString()
      })
    },
    include: { routeOptions: true, segments: true, reminderJobs: true }
  });
  return updated;
}

export async function getProfile() {
  return prisma.profile.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      city: "宁波",
      timezone: "Asia/Shanghai",
      defaultOriginName: "家",
      defaultOriginAddress: "金都嘉园52号",
      defaultOriginLngLat: "121.5230315924,29.8652491273"
    }
  });
}

async function buildRouteOptions(input: {
  origin: string;
  destination: string;
  city: string;
  cityd: string;
  arriveByLocal: string;
  insideVenueMinutes: number;
  waitAndFrictionMinutes: number;
}): Promise<BuiltRouteOption[]> {
  const bufferMinutes = input.insideVenueMinutes + input.waitAndFrictionMinutes;
  const transit = await amapService.transitDuration(input.origin, input.destination, input.city, input.cityd);
  const options: BuiltRouteOption[] = [
    {
      planKey: "fastest",
      title: "最快路线 · 公交/地铁",
      routeType: "transit",
      baseMinutes: transit.minutes,
      bufferMinutes,
      totalMinutes: transit.minutes + bufferMinutes,
      latestDepartLocal: computeLatestDepartLocal(input.arriveByLocal, transit.minutes + bufferMinutes),
      breakdown: [
        { mode: "walk", title: "步行至站点", detail: "按导航前往最近站点", minutes: 5 },
        { mode: "train", title: "公交/地铁", detail: "系统选择当前最快公共交通", minutes: Math.max(1, transit.minutes - 8) },
        { mode: "buffer", title: "进场与换乘缓冲", detail: "含场内步行和等候", minutes: bufferMinutes }
      ],
      raw: transit.raw
    }
  ];

  const habit = await bestHabitOption(input, bufferMinutes);
  if (habit) {
    options.push(habit);
  }

  const bike = await amapService.bikeDuration(input.origin, input.destination);
  const bikeBuffer = input.insideVenueMinutes + Math.max(2, Math.round(input.waitAndFrictionMinutes * 0.6));
  options.push({
    planKey: "bike_direct",
    title: "直骑小遛",
    routeType: "bike",
    baseMinutes: bike.minutes,
    bufferMinutes: bikeBuffer,
    totalMinutes: bike.minutes + bikeBuffer,
    latestDepartLocal: computeLatestDepartLocal(input.arriveByLocal, bike.minutes + bikeBuffer),
    breakdown: [
      { mode: "bike", title: "骑行至目的地", detail: "按共享单车/骑行路线前往", minutes: bike.minutes },
      { mode: "buffer", title: "停车与进场缓冲", detail: "含还车、进场和步行", minutes: bikeBuffer }
    ],
    raw: bike.raw
  });

  return options.sort((a, b) => a.totalMinutes - b.totalMinutes);
}

async function bestHabitOption(
  input: Parameters<typeof buildRouteOptions>[0],
  bufferMinutes: number
): Promise<BuiltRouteOption | null> {
  const candidates = await Promise.all(
    HABIT_STATIONS.map(async ([name, lngLat]) => {
      const bike = await amapService.bikeDuration(input.origin, lngLat);
      const transit = await amapService.transitDuration(lngLat, input.destination, input.city, input.cityd);
      const baseMinutes = bike.minutes + transit.minutes;
      return {
        planKey: `habit:${name}`,
        title: `习惯路线 · 小遛到${name} + 地铁`,
        routeType: "mixed",
        baseMinutes,
        bufferMinutes,
        totalMinutes: baseMinutes + bufferMinutes,
        latestDepartLocal: computeLatestDepartLocal(input.arriveByLocal, baseMinutes + bufferMinutes),
        breakdown: [
          { mode: "bike", title: `骑行至${name}`, detail: "从家到常用地铁入口", minutes: bike.minutes },
          { mode: "train", title: "地铁/公交接驳", detail: `从${name}前往目的地`, minutes: transit.minutes },
          { mode: "buffer", title: "换乘与场内缓冲", detail: "含等车、换乘、进场", minutes: bufferMinutes }
        ],
        raw: { bike: bike.raw, transit: transit.raw }
      };
    })
  );
  candidates.sort((a, b) => a.totalMinutes - b.totalMinutes);
  return candidates[0] || null;
}

function buildReminderJobs(latestDepartLocal: string, timezone: string) {
  const offsets = [-30, -20, -15, -10, -5, 0];
  return offsets.map((offsetMinutes) => ({
    offsetMinutes,
    scheduledAt: localStringToDate(addMinutesToLocalString(latestDepartLocal, offsetMinutes), timezone)
  }));
}

function localStringToDate(local: string, _timezone: string) {
  const parts = parseLocalDateTime(local);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
}

async function createPendingMemoryFromMessage(sourceText: string, destinationName: string) {
  if (!/公司|学校|家|健身房|常去|以后/.test(sourceText)) {
    return;
  }
  await prisma.memory.create({
    data: {
      type: "alias",
      status: "pending",
      label: destinationName,
      sourceText,
      confidence: 0.72,
      valueJson: JSON.stringify({ destinationName })
    }
  });
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
