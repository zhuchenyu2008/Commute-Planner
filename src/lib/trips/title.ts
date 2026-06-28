type NormalizeRouteTitleInput = {
  title?: string | null;
  originName?: string | null;
  destinationName?: string | null;
};

function cleanEndpoint(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function normalizeRouteTitle({
  title,
  originName,
  destinationName,
}: NormalizeRouteTitleInput) {
  const origin = cleanEndpoint(originName);
  const destination = cleanEndpoint(destinationName);

  if (origin && destination) {
    return `${origin}-${destination}`;
  }

  return title?.trim() || "未命名行程";
}
