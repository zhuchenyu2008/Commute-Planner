import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
  type BuiltEmailTemplate,
} from "@/lib/notifications/email-templates";
import { buildAmapLink } from "@/lib/notifications/map-links";

export type TemplateTestEmail = BuiltEmailTemplate & {
  label: "到点提醒" | "时间更新";
};

export function buildTemplateTestEmails({
  now = new Date(),
}: {
  now?: Date;
} = {}): TemplateTestEmail[] {
  const departAt0830 = beijingClockTime(now, 8, 30);
  const departAt0835 = beijingClockTime(now, 8, 35);
  const arriveAt0915 = beijingClockTime(now, 9, 15);
  const departureDetailsUrl = buildAmapLink({
    destinationName: "龙湖天街",
  });
  const routeChangeDetailsUrl = buildAmapLink({
    destinationName: "科技园区A座",
    destinationAddress: "创新大道 123 号",
  });
  const departureInput = {
    tripTitle: "到点提醒测试路线",
    destinationName: "龙湖天街",
    destinationAddress: null,
    latestDepartAt: departAt0830,
    targetArriveAt: arriveAt0915,
    totalMinutes: 45,
    routeTitle: "地铁 4号线 -> 共享单车",
    weatherSummary: "24°C 小雨",
    detailsUrl: departureDetailsUrl,
    stopMonitoringUrl: undefined,
  };
  const routeChangeInput = {
    tripTitle: "测试通勤路线",
    destinationName: "科技园区A座",
    destinationAddress: "创新大道 123 号",
    latestDepartAt: departAt0835,
    previousLatestDepartAt: departAt0830,
    targetArriveAt: arriveAt0915,
    totalMinutes: 40,
    routeTitle: "快速路高架 -> 绕城高速",
    weatherSummary: "22°C",
    detailsUrl: routeChangeDetailsUrl,
    stopMonitoringUrl: undefined,
  };

  return [
    {
      label: "到点提醒",
      ...buildDepartureReminderEmail(departureInput),
    },
    {
      label: "时间更新",
      ...buildRouteChangeEmail({
        ...routeChangeInput,
        changeMinutes: 5,
      }),
    },
  ];
}

function beijingClockTime(base: Date, hour: number, minute: number) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(base)
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") {
        parts[part.type] = part.value;
      }

      return parts;
    }, {});

  return new Date(
    Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      hour - 8,
      minute
    )
  );
}
