export function formatMemoryKind(kind: string) {
  const labels: Record<string, string> = {
    destination: "目的地",
    habit: "习惯",
    origin: "出发点",
    place: "地点",
    preference: "偏好",
    route_preference: "路线偏好",
  };

  return labels[kind] ?? "记忆";
}
