export type BufferSource =
  | "agent_inference"
  | "user_setting"
  | "memory"
  | "weather_context"
  | "manual_override";

export type BufferComponentInput = {
  category: string;
  label: string;
  minutes: number;
  reason: string;
  source?: BufferSource;
};

export type NormalizedBufferComponent = {
  order: number;
  category: string;
  label: string;
  minutes: number;
  reason: string;
  source: BufferSource;
};

export type ReminderKind = "recheck" | "depart_now";

export type ReminderJobData = {
  tripId: string;
  legId: string;
  kind: ReminderKind;
  scheduledFor: Date;
  dedupeKey: string;
  payloadJson: string;
};

export type PlannedTripStopInput = {
  order?: number;
  name: string;
  address?: string;
  lngLat?: string;
  targetArriveAt?: Date;
  plannedStayMin?: number;
  kind?: string;
  notes?: string;
};

export type PlannedTripLegInput = {
  order?: number;
  originName?: string;
  originLngLat?: string;
  destinationName?: string;
  destinationLngLat?: string;
  routeMinutes: number;
  bufferMinutes?: number;
  totalMinutes?: number;
  bufferComponents?: BufferComponentInput[];
  latestDepartAt?: Date;
  targetArriveAt?: Date;
  mode?: string;
  routeTitle?: string;
  routeRationale?: string;
  segmentTitle?: string;
  segmentDetail?: string;
  segmentSource?: string;
  source?: unknown;
};

export type CreatePlannedTripInput = {
  userId: string;
  agentSessionId?: string;
  rawPrompt: string;
  timezone: string;
  title: string;
  targetArriveAt?: Date;
  finalStopName?: string;
  stops: PlannedTripStopInput[];
  legs?: PlannedTripLegInput[];
};
