export type AgentToolName =
  | "read_settings"
  | "read_memories"
  | "search_poi"
  | "get_weather_reference"
  | "get_transit_route"
  | "get_walking_route"
  | "get_bicycling_route"
  | "create_trip"
  | "create_reminders"
  | "create_notification_log";

export type AgentSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out";

export type AgentToolCallStatus = "running" | "completed" | "failed";

export type StartPlanningSessionInput = {
  userId: string;
  prompt: string;
};

export type PlanningSessionResult = {
  sessionId: string;
  status: AgentSessionStatus;
  tripId: string | null;
};

export type PlanningAttemptResult = {
  tripId: string;
  summary: string;
};
