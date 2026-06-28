import { prisma } from "@/lib/db";
import { normalizeBufferComponents } from "@/lib/trips/buffers";
import { buildReminderSchedule } from "@/lib/trips/reminders";
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
    label: "Venue arrival buffer",
    minutes: 5,
    reason: "Allow time to find the entrance and settle in.",
    source: "agent_inference",
  },
  {
    category: "transfer",
    label: "Transfer buffer",
    minutes: 5,
    reason: "Allow time for elevator, parking, or platform transfer friction.",
    source: "agent_inference",
  },
  {
    category: "weather_context",
    label: "Weather monitoring reference",
    minutes: 0,
    reason: "Weather context is monitored without adding fixed minutes.",
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
    throw new Error("createPlannedTrip requires at least one destination stop.");
  }

  if (input.stops.length < 2 && !hasExplicitLegEndpoints(input.legs)) {
    throw new Error(
      "createPlannedTrip requires an origin stop or explicit leg endpoints."
    );
  }
}

function serialize(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
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
    const trip = await tx.trip.create({
      data: {
        userId: input.userId,
        agentSessionId: input.agentSessionId,
        title: input.title,
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
      throw new Error("createPlannedTrip requires at least one leg.");
    }

    for (const [index, legInput] of legInputs.entries()) {
      const order = legInput.order ?? index;
      const fromStop = explicitLegEndpoints ? stops[index - 1] : stops[index];
      const toStop =
        (explicitLegEndpoints
          ? stops.find((stop) => stop.order === order) ?? stops[index]
          : stops[index + 1]) ?? stops[stops.length - 1];
      if (!toStop) {
        throw new Error(`Missing destination stop for leg order ${order}.`);
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
          title: legInput.routeTitle ?? `${originName} to ${destinationName}`,
          mode: legInput.mode ?? "transit",
          routeMinutes,
          bufferMinutes,
          totalMinutes,
          selected: true,
          rationale:
            legInput.routeRationale ??
            "Selected as the initial monitoring route for this leg.",
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
