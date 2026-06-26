type JsonBackedTrip = {
  bufferJson: string;
  notificationJson: string;
  routeOptions?: unknown[];
  segments?: unknown[];
  reminderJobs?: unknown[];
  [key: string]: unknown;
};

type JsonBackedMemory = {
  valueJson: string;
  [key: string]: unknown;
};

export function serializeTrip(trip: JsonBackedTrip) {
  return {
    ...trip,
    buffer: safeJson(trip.bufferJson),
    notifications: safeJson(trip.notificationJson),
    routeOptions: trip.routeOptions || [],
    segments: trip.segments || [],
    reminderJobs: trip.reminderJobs || []
  };
}

export function serializeMemory(memory: JsonBackedMemory) {
  return {
    ...memory,
    value: safeJson(memory.valueJson)
  };
}

export function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
