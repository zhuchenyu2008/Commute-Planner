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

const BRAND_BLUE = "#2563eb";
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

function normalizeUrl(url: string | undefined) {
  return url?.trim() || "#";
}

function keyFact(label: string, value: string, icon: string) {
  return `
    <tr>
      <td style="width:44px;vertical-align:top;color:${MUTED};font-size:26px;">${icon}</td>
      <td style="vertical-align:top;">
        <div style="font-size:13px;color:${MUTED};line-height:20px;">${escapeHtml(label)}</div>
        <div style="font-size:26px;font-weight:700;color:${TEXT};line-height:34px;">${escapeHtml(value)}</div>
      </td>
    </tr>`;
}

function baseContainer(innerHtml: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>AI Commute</title>
  </head>
  <body style="margin:0;background:${SURFACE};font-family:Inter,Arial,'Microsoft YaHei',sans-serif;color:${TEXT};">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;">
      ${innerHtml}
    </div>
  </body>
</html>`;
}

function valueOrPending(value: string | null | undefined) {
  return value?.trim() || "待确认";
}

function detailsBlock(input: CommuteEmailTemplateInput) {
  const destinationAddress = valueOrPending(input.destinationAddress);
  const routeTitle = valueOrPending(input.routeTitle);
  const weatherSummary = valueOrPending(input.weatherSummary);

  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:20px;">
      ${keyFact("最晚出发时间", formatBeijingTime(input.latestDepartAt), "⏱")}
      ${keyFact("预计到达时间", formatBeijingTime(input.targetArriveAt), "🏁")}
      ${keyFact("预计通勤时长", formatMinutes(input.totalMinutes), "🧭")}
    </table>
    <div style="margin-top:24px;padding:18px;border:1px solid ${OUTLINE};border-radius:12px;background:#ffffff;">
      <div style="font-size:13px;color:${MUTED};line-height:20px;">目的地</div>
      <div style="font-size:18px;font-weight:700;color:${TEXT};line-height:28px;">${escapeHtml(input.destinationName)}</div>
      <div style="font-size:14px;color:${MUTED};line-height:22px;">${escapeHtml(destinationAddress)}</div>
      <div style="height:14px;"></div>
      <div style="font-size:13px;color:${MUTED};line-height:20px;">路线</div>
      <div style="font-size:15px;color:${TEXT};line-height:24px;">${escapeHtml(routeTitle)}</div>
      <div style="height:14px;"></div>
      <div style="font-size:13px;color:${MUTED};line-height:20px;">天气</div>
      <div style="font-size:15px;color:${TEXT};line-height:24px;">${escapeHtml(weatherSummary)}</div>
    </div>`;
}

function ctaBlock(detailsUrl: string, stopMonitoringUrl: string) {
  const safeDetailsUrl = escapeHtml(normalizeUrl(detailsUrl));
  const safeStopMonitoringUrl = escapeHtml(normalizeUrl(stopMonitoringUrl));

  return `
    <div style="margin-top:28px;">
      <a href="${safeDetailsUrl}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:24px;padding:13px 22px;border-radius:8px;">查看实时地图</a>
    </div>
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid ${OUTLINE};font-size:12px;color:${MUTED};line-height:20px;">
      如不再需要提醒，可<a href="${safeStopMonitoringUrl}" style="color:${MUTED};">停止监控此行程</a>。
    </div>`;
}

function buildPlainText(
  heading: string,
  input: CommuteEmailTemplateInput,
  intro?: string
) {
  return [
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
    `查看实时地图：${normalizeUrl(input.detailsUrl)}`,
    `停止监控：${normalizeUrl(input.stopMonitoringUrl)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDepartureReminderEmail(
  input: CommuteEmailTemplateInput
): BuiltEmailTemplate {
  const appName = input.appName?.trim() || "AI Commute";

  const html = baseContainer(`
    <div style="padding:28px 28px 32px;">
      <div style="font-size:14px;font-weight:700;color:${BRAND_BLUE};line-height:22px;">${escapeHtml(appName)}</div>
      <h1 style="margin:12px 0 0;font-size:30px;line-height:38px;color:${TEXT};">该出发了</h1>
      <p style="margin:12px 0 0;font-size:15px;line-height:24px;color:${MUTED};">请在 ${escapeHtml(formatBeijingTime(input.latestDepartAt))} 前出发，预留足够通勤时间抵达 ${escapeHtml(input.destinationName)}。</p>
      ${detailsBlock(input)}
      ${ctaBlock(input.detailsUrl ?? "#", input.stopMonitoringUrl ?? "#")}
    </div>`);

  return {
    subject: "通勤提醒：该出发了",
    text: buildPlainText("该出发了", input),
    html,
  };
}

export function buildRouteChangeEmail(
  input: RouteChangeEmailTemplateInput
): BuiltEmailTemplate {
  const changeText = `受路况影响，出发时间变化约 ${Math.round(input.changeMinutes)} 分钟`;
  const previousDepartAt = formatBeijingTime(input.previousLatestDepartAt);

  const html = baseContainer(`
    <div style="padding:28px 28px 32px;">
      <div style="font-size:14px;font-weight:700;color:${ERROR};line-height:22px;">Lumina Velocity</div>
      <h1 style="margin:12px 0 0;font-size:30px;line-height:38px;color:${TEXT};">出发时间已更新</h1>
      <p style="margin:12px 0 0;font-size:15px;line-height:24px;color:${MUTED};">${escapeHtml(changeText)}，请按新的最晚出发时间安排。</p>
      <div style="margin-top:18px;padding:14px 16px;border-left:4px solid ${ERROR};background:#fff7f7;font-size:14px;color:${TEXT};line-height:22px;">
        原最晚出发时间：${escapeHtml(previousDepartAt)}
      </div>
      ${detailsBlock(input)}
      ${ctaBlock(input.detailsUrl ?? "#", input.stopMonitoringUrl ?? "#")}
    </div>`);

  return {
    subject: `通勤时间已变化：${input.tripTitle}`,
    text: buildPlainText("出发时间已更新", input, `变化约 ${Math.round(input.changeMinutes)} 分钟`),
    html,
  };
}
