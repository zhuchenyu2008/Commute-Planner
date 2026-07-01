import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
  type BuiltEmailTemplate,
} from "@/lib/notifications/email-templates";

export type TemplateTestEmail = BuiltEmailTemplate & {
  label: "到点提醒" | "时间更新";
};

function appUrl(path: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) return undefined;

  try {
    const parsedBaseUrl = new URL(baseUrl);

    if (
      parsedBaseUrl.protocol !== "http:" &&
      parsedBaseUrl.protocol !== "https:"
    ) {
      return undefined;
    }

    return new URL(path, parsedBaseUrl).toString();
  } catch {
    return undefined;
  }
}

export function buildTemplateTestEmails({
  now = new Date(),
}: {
  now?: Date;
} = {}): TemplateTestEmail[] {
  const latestDepartAt = new Date(now.getTime() + 35 * 60_000);
  const previousLatestDepartAt = new Date(now.getTime() + 30 * 60_000);
  const targetArriveAt = new Date(now.getTime() + 75 * 60_000);
  const base = {
    tripTitle: "测试通勤路线",
    destinationName: "科技园区A座",
    destinationAddress: "创新大道 123 号",
    latestDepartAt,
    targetArriveAt,
    totalMinutes: 40,
    routeTitle: "地铁 4 号线 -> 共享单车",
    weatherSummary: "以行程详情为准",
    detailsUrl: appUrl("/history"),
    stopMonitoringUrl: undefined,
  };

  return [
    {
      label: "到点提醒",
      ...buildDepartureReminderEmail(base),
    },
    {
      label: "时间更新",
      ...buildRouteChangeEmail({
        ...base,
        previousLatestDepartAt,
        changeMinutes: 5,
      }),
    },
  ];
}
