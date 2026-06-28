type EnvSource = Partial<Record<string, string | undefined>>;

const hasValue = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function isSchedulerAuthorized(
  request: Request,
  env: EnvSource = process.env
) {
  const secret = env.SCHEDULER_TICK_SECRET?.trim();

  if (!hasValue(secret)) {
    return true;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = request.headers.get("x-scheduler-secret")?.trim();

  return bearer === secret || headerSecret === secret;
}
