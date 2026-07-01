export type CommuteEmailTemplateInput = {
  appName?: string;
  tripTitle: string;
  destinationName: string;
  destinationAddress?: string | null;
  latestDepartAt?: Date | null;
  previousLatestDepartAt?: Date | null;
  targetArriveAt?: Date | null;
  totalMinutes?: number | null;
  routeTitle?: string | null;
  weatherSummary?: string | null;
  detailsUrl?: string;
  stopMonitoringUrl?: string;
};

export type RouteChangeEmailTemplateInput = CommuteEmailTemplateInput & {
  changeMinutes: number;
};

export type BuiltEmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

const DEFAULT_APP_NAME = "AI Commute";
const BRAND_BLUE = "#2563eb";
const LINK_BLUE = "#0284c7";
const SURFACE = "#f7f9fb";
const TEXT = "#191c1e";
const MUTED = "#434655";
const OUTLINE = "#c3c6d7";
const ERROR = "#EF4444";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBeijingTime(date: Date | null | undefined) {
  if (!date) return "待确认";

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatMinutes(minutes: number | null | undefined) {
  return typeof minutes === "number" && Number.isFinite(minutes)
    ? `${Math.round(minutes)} 分钟`
    : "待确认";
}

function normalizeHttpUrl(url: string | undefined) {
  const trimmed = url?.trim();

  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);

    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function resolveAppName(input: CommuteEmailTemplateInput) {
  return input.appName?.trim() || DEFAULT_APP_NAME;
}

function valueOrPending(value: string | null | undefined) {
  return value?.trim() || "待确认";
}

function baseContainer(title: string, innerHtml: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:${SURFACE};font-family:Inter,Arial,'Microsoft YaHei',sans-serif;color:${TEXT};">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;">
      <div style="padding:32px 28px 36px;">
        ${innerHtml}
      </div>
    </div>
  </body>
</html>`;
}

function timeValue(value: string) {
  return `<span style="color:${LINK_BLUE};font-weight:800;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;">${escapeHtml(value)}</span>`;
}

function metricRow({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return `
    <tr>
      <td style="width:56px;padding:9px 14px 9px 0;vertical-align:top;font-size:30px;line-height:36px;">${icon}</td>
      <td style="padding:8px 0;vertical-align:top;">
        <div style="font-size:16px;color:${MUTED};line-height:24px;">${escapeHtml(label)}</div>
        <div style="margin-top:2px;font-size:34px;font-weight:800;line-height:42px;color:${accent ? LINK_BLUE : TEXT};">${accent ? timeValue(value) : escapeHtml(value)}</div>
      </td>
    </tr>`;
}

function metricsBlock(input: CommuteEmailTemplateInput) {
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:28px;">
      ${metricRow({
        icon: "⏱️",
        label: "最晚出发时间",
        value: formatBeijingTime(input.latestDepartAt),
        accent: true,
      })}
      ${metricRow({
        icon: "🏁",
        label: "预计到达时间",
        value: formatBeijingTime(input.targetArriveAt),
        accent: true,
      })}
      ${metricRow({
        icon: "🧭",
        label: "预计通勤时长",
        value: formatMinutes(input.totalMinutes),
      })}
    </table>`;
}

function detailsCard(input: CommuteEmailTemplateInput) {
  const destinationAddress = valueOrPending(input.destinationAddress);
  const routeTitle = valueOrPending(input.routeTitle);
  const weatherSummary = valueOrPending(input.weatherSummary);

  return `
    <div style="margin-top:28px;padding:22px 24px;border:1px solid ${OUTLINE};border-radius:18px;background:#ffffff;">
      <div style="font-size:16px;color:${MUTED};line-height:24px;">目的地</div>
      <div style="margin-top:4px;font-size:23px;font-weight:800;color:${TEXT};line-height:32px;">${escapeHtml(input.destinationName)}</div>
      <div style="margin-top:4px;font-size:16px;color:${MUTED};line-height:24px;">${escapeHtml(destinationAddress)}</div>
      <div style="height:22px;"></div>
      <div style="font-size:16px;color:${MUTED};line-height:24px;">路线</div>
      <div style="margin-top:4px;font-size:19px;font-weight:700;color:${TEXT};line-height:28px;">${escapeHtml(routeTitle)}</div>
      <div style="height:22px;"></div>
      <div style="font-size:16px;color:${MUTED};line-height:24px;">天气</div>
      <div style="margin-top:4px;font-size:19px;font-weight:700;color:${TEXT};line-height:28px;">${escapeHtml(weatherSummary)}</div>
    </div>`;
}

function actionAndFooterBlock(input: CommuteEmailTemplateInput, footerText: string) {
  const detailsUrl = normalizeHttpUrl(input.detailsUrl);
  const stopMonitoringUrl = normalizeHttpUrl(input.stopMonitoringUrl);
  const cta = detailsUrl
    ? `
      <div style="margin-top:28px;">
        <a href="${escapeHtml(detailsUrl)}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:18px;font-weight:800;line-height:26px;padding:15px 30px;border-radius:10px;">查看实时地图</a>
      </div>`
    : "";
  const stopLink = stopMonitoringUrl
    ? ` <a href="${escapeHtml(stopMonitoringUrl)}" style="color:${MUTED};text-decoration:underline;">停止监控此行程</a>`
    : "";

  return `
    ${cta}
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid ${OUTLINE};font-size:12px;color:${MUTED};line-height:20px;">
      ${escapeHtml(footerText)}${stopLink}
    </div>`;
}

function compactHeader(appName: string, tone: "brand" | "error" = "brand") {
  return `
    <div style="font-size:18px;font-weight:800;color:${tone === "error" ? ERROR : BRAND_BLUE};line-height:26px;">
      ${escapeHtml(appName)}
    </div>`;
}

function buildPlainText(
  brand: string,
  heading: string,
  input: CommuteEmailTemplateInput,
  intro?: string
) {
  const detailsUrl = normalizeHttpUrl(input.detailsUrl);
  const stopMonitoringUrl = normalizeHttpUrl(input.stopMonitoringUrl);
  const lines = [
    brand,
    heading,
    intro,
    `行程：${input.tripTitle}`,
    `最晚出发时间：${formatBeijingTime(input.latestDepartAt)}`,
    `预计到达时间：${formatBeijingTime(input.targetArriveAt)}`,
    `预计通勤时长：${formatMinutes(input.totalMinutes)}`,
    `目的地：${input.destinationName}`,
    `地址：${valueOrPending(input.destinationAddress)}`,
    `路线：${valueOrPending(input.routeTitle)}`,
    `天气：${valueOrPending(input.weatherSummary)}`,
    detailsUrl ? `查看实时地图：${detailsUrl}` : null,
    stopMonitoringUrl ? `停止监控：${stopMonitoringUrl}` : null,
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function buildDepartureReminderEmail(
  input: CommuteEmailTemplateInput
): BuiltEmailTemplate {
  const appName = resolveAppName(input);
  const latestDepartAt = formatBeijingTime(input.latestDepartAt);
  const html = baseContainer(
    "通勤提醒：该出发了",
    `
      ${compactHeader(appName)}
      <h1 style="margin:22px 0 0;font-size:38px;line-height:48px;color:${TEXT};font-weight:800;">该出发了</h1>
      <p style="margin:18px 0 0;font-size:18px;line-height:32px;color:${MUTED};">请在 ${timeValue(latestDepartAt)} 前出发，预留足够通勤时间抵达 ${escapeHtml(input.destinationName)}。</p>
      ${metricsBlock(input)}
      ${detailsCard(input)}
      ${actionAndFooterBlock(input, "此为自动发送的行程提醒邮件。")}
    `
  );

  return {
    subject: "通勤提醒：该出发了",
    text: buildPlainText(appName, "该出发了", input),
    html,
  };
}

export function buildRouteChangeEmail(
  input: RouteChangeEmailTemplateInput
): BuiltEmailTemplate {
  const appName = resolveAppName(input);
  const roundedChangeMinutes = Math.round(Math.abs(input.changeMinutes));
  const changeText = `受路况影响，出发时间变化约 ${roundedChangeMinutes} 分钟`;
  const previousDepartAt = formatBeijingTime(input.previousLatestDepartAt);
  const plainTextIntro = [
    changeText,
    `原最晚出发时间：${previousDepartAt}`,
  ].join("\n");
  const html = baseContainer(
    `通勤时间已变化：${input.tripTitle}`,
    `
      ${compactHeader(appName, "error")}
      <h1 style="margin:22px 0 0;font-size:38px;line-height:48px;color:${TEXT};font-weight:800;">出发时间已更新</h1>
      <p style="margin:18px 0 0;font-size:18px;line-height:32px;color:${MUTED};">${escapeHtml(changeText)}，请按新的最晚出发时间安排。</p>
      <div style="margin-top:22px;padding:18px 20px;border-left:6px solid ${ERROR};background:#fff7f7;font-size:17px;color:${TEXT};line-height:26px;">
        原最晚出发时间：${timeValue(previousDepartAt)}
      </div>
      ${metricsBlock(input)}
      ${detailsCard(input)}
      ${actionAndFooterBlock(input, "此为自动发送的行程复查邮件。")}
    `
  );

  return {
    subject: `通勤时间已变化：${input.tripTitle}`,
    text: buildPlainText(appName, "出发时间已更新", input, plainTextIntro),
    html,
  };
}
