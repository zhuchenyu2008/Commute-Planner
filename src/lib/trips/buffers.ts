import type {
  BufferComponentInput,
  NormalizedBufferComponent,
} from "@/lib/trips/types";

function normalizeMinutes(component: BufferComponentInput) {
  if (
    component.source === "weather_context" ||
    component.category === "weather_context"
  ) {
    return 0;
  }

  return Math.max(0, Math.round(component.minutes));
}

export function normalizeBufferComponents(
  components: BufferComponentInput[]
): NormalizedBufferComponent[] {
  return components.map((component, index) => ({
    order: index,
    category: component.category,
    label: component.label,
    minutes: normalizeMinutes(component),
    reason: component.reason,
    source: component.source ?? "agent_inference",
  }));
}
