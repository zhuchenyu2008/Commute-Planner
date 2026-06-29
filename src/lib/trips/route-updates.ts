import { prisma } from "@/lib/db";
import { normalizeBufferComponents } from "@/lib/trips/buffers";
export { cancelTripMonitoring } from "@/lib/trips/monitoring";
import { buildReminderSchedule } from "@/lib/trips/reminders";
import { normalizeRouteTitle } from "@/lib/trips/title";
import type {
  BufferComponentInput,
  PlannedTripLegInput,
  PlannedTripStopInput,
} from "@/lib/trips/types";

const DEFAULT_ROUTE_MINUTES = 30;
const DEFAULT_BUFFER_COMPONENTS: BufferComponentInput[] = [
  {
    category: "venue",
    label: "到场缓冲",
    minutes: 5,
    reason: "预留到达后寻找入口和完成进场的时间。",
    source: "agent_inference",
  },
  {
    category: "transfer",
    label: "换乘缓冲",
    minutes: 5,
    reason: "预留换乘、步行和等候的摩擦时间。",
    source: "agent_inference",
  },
  {
    category: "weather_context",
    label: "天气参考",
    minutes: 0,
    reason: "天气信息仅作为监控参考，不额外增加固定分钟数。",
    source: "weather_context",
  },
];

type TripRouteUpdateInput = {
  tripId: string;
  userId: string;
  title?: string;
  finalStopName?: string;
  targetArriveAt?: Date;
  status?: string;
};

export type ReplaceTripRouteInput = TripRouteUpdateInput & {
  stops: PlannedTripStopInput[];
  legs: PlannedTripLegInput[];
};

export type CreateMemoryCandidateForTripInput = {
  userId: string;
  tripId?: string | null;
  kind: string;
  label: string;
  valueJson: unknown;
};

export type SelectRouteCandidateInput = {
  tripId: string;
  userId: string;
  legId?: string;
  legOrder?: number;
  candidateId?: string;
  candidateKey?: string;
};

export type ReplaceReminderScheduleInput = {
  tripId: string;
  userId: string;
  legId?: string;
  legOrder?: number;
  cadenceMinutes?: readonly number[];
};

type PersistedStopForRoute = {
  id: string;
  name: string;
  lngLat: string | null;
  order: number;
  targetArriveAt: Date | null;
};

function serialize(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
}

function normalizeCadenceMinutes(cadenceMinutes?: readonly number[]) {
  if (!cadenceMinutes) {
    return undefined;
  }

  const normalized = cadenceMinutes.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error("Reminder cadence minutes must be non-negative numbers.");
    }

    return Math.round(numeric);
  });

  return [...new Set(normalized)].sort((left, right) => right - left);
}

function byInputOrder<T extends { order?: number | null }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (left.order ?? items.indexOf(left)) - (right.order ?? items.indexOf(right))
  );
}

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

function normalizeEndpoint(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function findStopByEndpoint(
  stops: PersistedStopForRoute[],
  name?: string,
  lngLat?: string
) {
  const normalizedLngLat = normalizeEndpoint(lngLat);
  const normalizedName = normalizeEndpoint(name);

  return stops.find((stop) => {
    if (normalizedLngLat && normalizeEndpoint(stop.lngLat) === normalizedLngLat) {
      return true;
    }

    return normalizedName && normalizeEndpoint(stop.name) === normalizedName;
  });
}

function resolveLegStops(input: {
  stops: PersistedStopForRoute[];
  legInput: PlannedTripLegInput;
  index: number;
  explicitLegEndpoints: boolean;
}) {
  const sequentialFrom = input.stops[input.index];
  const sequentialTo = input.stops[input.index + 1] ?? input.stops.at(-1);

  if (!input.explicitLegEndpoints) {
    return {
      fromStop: sequentialFrom,
      toStop: sequentialTo,
    };
  }

  const fromStop =
    findStopByEndpoint(
      input.stops,
      input.legInput.originName,
      input.legInput.originLngLat
    ) ??
    sequentialFrom ??
    input.stops[input.index - 1];
  const toStop =
    findStopByEndpoint(
      input.stops,
      input.legInput.destinationName,
      input.legInput.destinationLngLat
    ) ?? sequentialTo;

  return {
    fromStop,
    toStop,
  };
}

function defaultLatestDepartAt(
  targetArriveAt: Date | null | undefined,
  legInput: PlannedTripLegInput,
  routeMinutes: number,
  bufferMinutes: number
) {
  if (legInput.latestDepartAt) return legInput.latestDepartAt;

  const arriveAt = legInput.targetArriveAt ?? targetArriveAt ?? new Date();
  return new Date(arriveAt.getTime() - (routeMinutes + bufferMinutes) * 60_000);
}

async function findOwnedTrip(tripId: string, userId: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
  });

  if (!trip) {
    throw new Error("Trip not found.");
  }

  return trip;
}

export async function updateTripSummary(input: TripRouteUpdateInput) {
  const trip = await findOwnedTrip(input.tripId, input.userId);
  const legs = await prisma.tripLeg.findMany({
    where: { tripId: input.tripId },
    orderBy: { order: "asc" },
  });
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  const finalStopName =
    input.finalStopName ?? trip.finalStopName ?? lastLeg?.destinationName;

  return prisma.trip.update({
    where: { id: input.tripId },
    data: {
      title: normalizeRouteTitle({
        title: input.title ?? trip.title,
        originName: firstLeg?.originName,
        destinationName: finalStopName,
      }),
      finalStopName,
      targetArriveAt: input.targetArriveAt ?? trip.targetArriveAt,
      status: input.status ?? trip.status,
    },
  });
}

export async function replaceTripRoute(input: ReplaceTripRouteInput) {
  if (input.stops.length === 0) {
    throw new Error("Replacing a trip route requires at least one stop.");
  }

  if (input.legs.length === 0) {
    throw new Error("Replacing a trip route requires at least one leg.");
  }

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({
      where: { id: input.tripId, userId: input.userId },
    });

    if (!trip) {
      throw new Error("Trip not found.");
    }

    const orderedStops = byInputOrder(input.stops);
    const orderedLegs = byInputOrder(input.legs);
    const firstStop = orderedStops[0];
    const lastStop = orderedStops[orderedStops.length - 1];
    const firstLeg = orderedLegs[0];
    const lastLeg = orderedLegs[orderedLegs.length - 1];
    const finalStopName =
      input.finalStopName ?? lastLeg?.destinationName ?? lastStop.name;
    const title = normalizeRouteTitle({
      title: input.title ?? trip.title,
      originName: firstLeg?.originName ?? firstStop.name,
      destinationName: finalStopName,
    });

    await tx.reminderJob.deleteMany({ where: { tripId: trip.id } });
    await tx.bufferComponent.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.routeSegment.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.routeCandidate.deleteMany({ where: { leg: { tripId: trip.id } } });
    await tx.tripLeg.deleteMany({ where: { tripId: trip.id } });
    await tx.tripStop.deleteMany({ where: { tripId: trip.id } });

    const stops = [];
    for (const [index, stop] of orderedStops.entries()) {
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

    const explicitLegEndpoints = hasExplicitLegEndpoints(orderedLegs);
    for (const [index, legInput] of orderedLegs.entries()) {
      const order = legInput.order ?? index;
      const { fromStop, toStop } = resolveLegStops({
        stops,
        legInput,
        index,
        explicitLegEndpoints,
      });
      if (!toStop) {
        throw new Error(`Route leg ${order} is missing a destination stop.`);
      }

      const buffers = normalizeBufferComponents(
        legInput.bufferComponents ?? DEFAULT_BUFFER_COMPONENTS
      );
      const routeMinutes = Math.max(
        0,
        Math.round(legInput.routeMinutes ?? DEFAULT_ROUTE_MINUTES)
      );
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
        input.targetArriveAt ?? trip.targetArriveAt,
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
            "已选为该路段的更新后监控路线。",
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

    return tx.trip.update({
      where: { id: trip.id },
      data: {
        title,
        finalStopName,
        targetArriveAt: input.targetArriveAt ?? trip.targetArriveAt,
        status: input.status ?? "monitoring",
      },
    });
  });
}

export async function createMemoryCandidateForTrip(
  input: CreateMemoryCandidateForTripInput
) {
  if (input.tripId) {
    await findOwnedTrip(input.tripId, input.userId);
  }

  if (input.valueJson === undefined) {
    throw new Error("Memory candidate valueJson is required.");
  }

  const valueJson =
    typeof input.valueJson === "string"
      ? input.valueJson
      : JSON.stringify(input.valueJson);

  return prisma.memoryCandidate.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      label: input.label,
      valueJson,
      status: "pending",
    },
  });
}

async function findOwnedLeg(input: {
  tripId: string;
  userId: string;
  legId?: string;
  legOrder?: number;
}) {
  await findOwnedTrip(input.tripId, input.userId);
  const legById = input.legId
    ? await prisma.tripLeg.findFirst({
        where: {
          tripId: input.tripId,
          id: input.legId,
        },
      })
    : null;
  const leg =
    legById ??
    (await prisma.tripLeg.findFirst({
      where: {
        tripId: input.tripId,
        order: input.legOrder ?? 0,
      },
    }));

  if (!leg) {
    throw new Error("Trip leg not found.");
  }

  return leg;
}

export async function selectRouteCandidate(input: SelectRouteCandidateInput) {
  const leg = await findOwnedLeg(input);
  const candidateById = input.candidateId
    ? await prisma.routeCandidate.findFirst({
        where: {
          legId: leg.id,
          id: input.candidateId,
        },
      })
    : null;
  const candidate =
    candidateById ??
    (await prisma.routeCandidate.findFirst({
      where: {
        legId: leg.id,
        key: input.candidateKey ?? `leg-${leg.order}-selected`,
      },
    }));

  if (!candidate) {
    throw new Error("Route candidate not found.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.routeCandidate.updateMany({
      where: { legId: leg.id },
      data: { selected: false },
    });
    const selected = await tx.routeCandidate.update({
      where: { id: candidate.id },
      data: { selected: true },
    });
    await tx.tripLeg.update({
      where: { id: leg.id },
      data: { selectedCandidateId: selected.id },
    });
    return selected;
  });
}

export async function replaceReminderSchedule(input: ReplaceReminderScheduleInput) {
  await findOwnedTrip(input.tripId, input.userId);
  const cadenceMinutes = normalizeCadenceMinutes(input.cadenceMinutes);
  const legs = input.legId || input.legOrder !== undefined
    ? [await findOwnedLeg(input)]
    : await prisma.tripLeg.findMany({
        where: { tripId: input.tripId },
        orderBy: { order: "asc" },
      });

  return prisma.$transaction(async (tx) => {
    await tx.reminderJob.deleteMany({
      where: {
        tripId: input.tripId,
        ...(input.legId || input.legOrder !== undefined
          ? { legId: legs[0]?.id }
          : {}),
      },
    });

    for (const leg of legs) {
      if (!leg.latestDepartAt) continue;
      await tx.reminderJob.createMany({
        data: buildReminderSchedule({
          tripId: input.tripId,
          legId: leg.id,
          latestDepartAt: leg.latestDepartAt,
          cadenceMinutes,
        }),
      });
    }

    return tx.reminderJob.findMany({
      where: { tripId: input.tripId },
      orderBy: { scheduledFor: "asc" },
    });
  });
}
