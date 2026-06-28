import { prisma } from "@/lib/db";
import { normalizeBufferComponents } from "@/lib/trips/buffers";
import { buildReminderSchedule } from "@/lib/trips/reminders";
import { normalizeRouteTitle } from "@/lib/trips/title";
import type {
  BufferComponentInput,
  CreatePlannedTripInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";

const DEFAULT_ROUTE_MINUTES = 30;
const DEFAULT_BUFFER_COMPONENTS: BufferComponentInput[] = [
  {
    category: "venue",
    label: "到场缓冲",
    minutes: 5,
    reason: "预留寻找入口并完成进场的时间。",
    source: "agent_inference",
  },
  {
    category: "transfer",
    label: "换乘缓冲",
    minutes: 5,
    reason: "预留电梯、停车或站台换乘等摩擦时间。",
    source: "agent_inference",
  },
  {
    category: "weather_context",
    label: "天气监控参考",
    minutes: 0,
    reason: "天气信息仅用于监控参考，不额外增加固定分钟数。",
    source: "weather_context",
  },
];

function hasExplicitLegEndpoints(legs: PlannedTripLegInput[] | undefined) {
  return (
    legs?.some(
      (leg) =>
        leg.originName !== undefined ||
        leg.originLngLat !== undefined ||
        leg.destinationName !== undefined ||
        leg.destinationLngLat !== undefined
    ) ?? false
  );
}

function validateInput(input: CreatePlannedTripInput) {
  if (input.stops.length === 0) {
    throw new Error("创建行程至少需要一个目的地停靠点。");
  }

  if (input.stops.length < 2 && !hasExplicitLegEndpoints(input.legs)) {
    throw new Error(
      "创建行程需要出发点停靠点或明确的路线起终点。"
    );
  }
}

function serialize(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
}

function byInputOrder<T extends { order?: number | null }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (left.order ?? items.indexOf(left)) - (right.order ?? items.indexOf(right))
  );
}

function defaultLatestDepartAt(
  input: CreatePlannedTripInput,
  legInput: PlannedTripLegInput,
  routeMinutes: number,
  bufferMinutes: number
) {
  if (legInput.latestDepartAt) return legInput.latestDepartAt;

  const arriveAt = legInput.targetArriveAt ?? input.targetArriveAt ?? new Date();
  return new Date(arriveAt.getTime() - (routeMinutes + bufferMinutes) * 60_000);
}

export async function createPlannedTrip(input: CreatePlannedTripInput) {
  validateInput(input);

  return prisma.$transaction(async (tx) => {
    const orderedStops = byInputOrder(input.stops);
    const orderedLegs = byInputOrder(input.legs ?? []);
    const firstLeg = orderedLegs[0];
    const firstStop = orderedStops[0];
    const lastStop = orderedStops[orderedStops.length - 1];
    const lastLeg = orderedLegs[orderedLegs.length - 1];
    const normalizedTitle = normalizeRouteTitle({
      title: input.title,
      originName: firstLeg?.originName ?? firstStop?.name,
      destinationName:
        input.finalStopName ?? lastStop?.name ?? lastLeg?.destinationName,
    });

    const trip = await tx.trip.create({
      data: {
        userId: input.userId,
        agentSessionId: input.agentSessionId,
        title: normalizedTitle,
        rawPrompt: input.rawPrompt,
        status: "monitoring",
        timezone: input.timezone,
        targetArriveAt: input.targetArriveAt,
        finalStopName:
          input.finalStopName ?? input.stops[input.stops.length - 1]?.name,
      },
    });

    const stops = [];
    for (const [index, stop] of input.stops.entries()) {
      const order = stop.order ?? index;
      stops.push(
        await tx.tripStop.create({
          data: {
            tripId: trip.id,
            order,
            name: stop.name,
            address: stop.address,
            lngLat: stop.lngLat,
            targetArriveAt: stop.targetArriveAt,
            plannedStayMin: stop.plannedStayMin,
            kind: stop.kind ?? (order === 0 ? "origin" : "destination"),
            notes: stop.notes,
          },
        })
      );
    }

    const explicitLegEndpoints = hasExplicitLegEndpoints(input.legs);
    const legInputs = explicitLegEndpoints
      ? input.legs ?? []
      : Array.from({ length: stops.length - 1 }, (_, index) =>
          input.legs?.[index] ?? { routeMinutes: DEFAULT_ROUTE_MINUTES }
        );

    if (legInputs.length === 0) {
      throw new Error("创建行程至少需要一段路线。");
    }

    for (const [index, legInput] of legInputs.entries()) {
      const order = legInput.order ?? index;
      const fromStop = explicitLegEndpoints ? stops[index - 1] : stops[index];
      const toStop =
        (explicitLegEndpoints
          ? stops.find((stop) => stop.order === order) ?? stops[index]
          : stops[index + 1]) ?? stops[stops.length - 1];
      if (!toStop) {
        throw new Error(`第 ${order} 段路线缺少目的地停靠点。`);
      }
      const buffers = normalizeBufferComponents(
        legInput.bufferComponents ?? DEFAULT_BUFFER_COMPONENTS
      );
      const routeMinutes = Math.max(0, Math.round(legInput.routeMinutes));
      const computedBufferMinutes = buffers.reduce(
        (total, component) => total + component.minutes,
        0
      );
      const bufferMinutes = Math.max(
        0,
        Math.round(legInput.bufferMinutes ?? computedBufferMinutes)
      );
      const totalMinutes = Math.max(
        routeMinutes + bufferMinutes,
        Math.round(legInput.totalMinutes ?? routeMinutes + bufferMinutes)
      );
      const originName = legInput.originName ?? fromStop?.name ?? "";
      const originLngLat = legInput.originLngLat ?? fromStop?.lngLat ?? "";
      const destinationName = legInput.destinationName ?? toStop.name;
      const destinationLngLat = legInput.destinationLngLat ?? toStop.lngLat;
      const latestDepartAt = defaultLatestDepartAt(
        input,
        legInput,
        routeMinutes,
        bufferMinutes
      );

      const leg = await tx.tripLeg.create({
        data: {
          tripId: trip.id,
          order,
          fromStopId: fromStop?.id,
          toStopId: toStop.id,
          originName,
          originLngLat,
          destinationName,
          destinationLngLat,
          targetArriveAt: legInput.targetArriveAt ?? toStop.targetArriveAt,
          latestDepartAt,
          status: "monitoring",
        },
      });

      const candidate = await tx.routeCandidate.create({
        data: {
          legId: leg.id,
          key: `leg-${order}-selected`,
          title: legInput.routeTitle ?? `${originName} 到 ${destinationName}`,
          mode: legInput.mode ?? "transit",
          routeMinutes,
          bufferMinutes,
          totalMinutes,
          selected: true,
          rationale:
            legInput.routeRationale ??
            "已选为该路段的初始监控路线。",
          sourceJson: serialize(legInput.source),
        },
      });

      await tx.tripLeg.update({
        where: { id: leg.id },
        data: { selectedCandidateId: candidate.id },
      });

      await tx.routeSegment.create({
        data: {
          legId: leg.id,
          candidateId: candidate.id,
          order: 0,
          mode: legInput.mode ?? "transit",
          title: legInput.segmentTitle ?? candidate.title,
          detail: legInput.segmentDetail,
          minutes: routeMinutes,
          source: legInput.segmentSource ?? "agent",
          rawJson: serialize(legInput.source),
        },
      });

      await tx.bufferComponent.createMany({
        data: buffers.map((component) => ({
          legId: leg.id,
          order: component.order,
          category: component.category,
          label: component.label,
          minutes: component.minutes,
          reason: component.reason,
          source: component.source,
        })),
      });

      await tx.reminderJob.createMany({
        data: buildReminderSchedule({
          tripId: trip.id,
          legId: leg.id,
          latestDepartAt,
        }),
      });
    }

    return trip;
  });
}
