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
const PRIMARY = "#2563eb";
const PRIMARY_DARK = "#004ac6";
const TEXT = "#191c1e";
const MUTED = "#434655";
const OUTLINE = "#d8dde8";
const SURFACE_LOW = "#f2f4f6";
const SURFACE_CARD = "#ffffff";
const ERROR = "#EF4444";
const ERROR_CONTAINER = "#ffdad6";

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

function roundedMinutes(minutes: number | null | undefined) {
  return typeof minutes === "number" && Number.isFinite(minutes)
    ? Math.round(minutes)
    : null;
}

function formatMinutes(minutes: number | null | undefined) {
  const value = roundedMinutes(minutes);

  return value === null ? "待确认" : `${value} 分钟`;
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

function baseContainer({
  title,
  innerHtml,
  maxWidth,
  background = "#ffffff",
  verticalMargin = 0,
}: {
  title: string;
  innerHtml: string;
  maxWidth: number;
  background?: string;
  verticalMargin?: number;
}) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:${background};font-family:Inter,Arial,'Microsoft YaHei',sans-serif;color:${TEXT};-webkit-font-smoothing:antialiased;">
    <div style="width:100%;max-width:${maxWidth}px;margin:${verticalMargin}px auto 0;background:#ffffff;overflow:hidden;">
      ${innerHtml}
    </div>
  </body>
</html>`;
}

function iconSvg(
  name:
    | "commute"
    | "route"
    | "clock"
    | "timer"
    | "pin"
    | "train"
    | "bike"
    | "rain"
    | "flag"
    | "building"
    | "sun-cloud",
  color = "#737686",
  size = 24
) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const strongAttrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

  switch (name) {
    case "commute":
      return `<svg ${strongAttrs}><rect x="3" y="7" width="10" height="8" rx="2"/><path d="M7 15v2M12 15v2M13 10h4l3 3v4h-3"/><path d="M15 17h2"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/></svg>`;
    case "route":
      return `<svg ${strongAttrs}><path d="M6 4v14"/><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><path d="M18 4c-4 0-4 4-4 8s0 8-4 8"/><circle cx="18" cy="4" r="2"/></svg>`;
    case "clock":
      return `<svg ${attrs}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 3"/></svg>`;
    case "timer":
      return `<svg ${attrs}><circle cx="12" cy="13" r="7"/><path d="M12 6V3M9 3h6M12 13V9"/></svg>`;
    case "pin":
      return `<svg ${attrs}><path d="M12 21s7-5.1 7-11a7 7 0 0 0-14 0c0 5.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>`;
    case "train":
      return `<svg ${strongAttrs}><rect x="6" y="4" width="12" height="13" rx="2"/><path d="M9 8h6M8 13h8M9 20l2-3M15 20l-2-3"/></svg>`;
    case "bike":
      return `<svg ${attrs}><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8.5 17 12 10l3 7M12 10h3M10 7h3"/></svg>`;
    case "rain":
      return `<svg ${strongAttrs}><path d="M7 16a4 4 0 1 1 1.1-7.85A5.5 5.5 0 0 1 19 10.5 3.5 3.5 0 0 1 18 17H7Z"/><path d="M8 20v1M12 20v1M16 20v1"/></svg>`;
    case "flag":
      return `<svg ${attrs}><path d="M6 21V5"/><path d="M6 5h10l-1.5 4L16 13H6"/></svg>`;
    case "building":
      return `<svg ${strongAttrs}><path d="M4 21h16"/><path d="M6 21V5h8v16"/><path d="M14 9h4v12"/><path d="M9 8h2M9 12h2M9 16h2"/></svg>`;
    case "sun-cloud":
      return `<svg ${strongAttrs}><path d="M12 3v2M4.2 6.2l1.4 1.4M3 14h2M18.4 7.6l1.4-1.4"/><circle cx="12" cy="12" r="4"/><path d="M8 18h9a3 3 0 0 0 .6-5.94A4.5 4.5 0 0 0 9.1 14 3 3 0 0 0 8 18Z"/></svg>`;
  }
}

function circularBrandIcon() {
  return `<span style="display:inline-flex;width:32px;height:32px;border-radius:9999px;background:${PRIMARY_DARK};align-items:center;justify-content:center;color:#ffffff;vertical-align:middle;">${iconSvg("commute", "#ffffff", 20)}</span>`;
}

function routeParts(routeTitle: string | null | undefined) {
  const parts = valueOrPending(routeTitle)
    .split(/\s*(?:->|→|到)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    primary: parts[0] ?? valueOrPending(routeTitle),
    secondary: parts[1] ?? "",
  };
}

function weatherParts(weatherSummary: string | null | undefined) {
  const summary = valueOrPending(weatherSummary);
  const match = summary.match(/^(-?\d+\s*(?:°C|℃|度C|度)?)(?:\s+(.+))?$/i);

  if (!match) {
    return { temperature: summary, condition: "" };
  }

  return {
    temperature: match[1].replace(/\s+/g, "").replace("℃", "°C"),
    condition: match[2]?.trim() ?? "",
  };
}

function departureFactRow(
  icon: string,
  label: string,
  value: string,
  withDivider = true
) {
  return `
    <div style="display:flex;gap:16px;align-items:flex-start;padding:${withDivider ? "0 0 16px" : "0"};${withDivider ? `border-bottom:1px solid ${OUTLINE};` : ""}">
      <div style="width:24px;min-width:24px;color:#737686;">${icon}</div>
      <div>
        <div style="font-size:12px;line-height:16px;color:${MUTED};letter-spacing:0.05em;">${escapeHtml(label)}</div>
        <div style="font-size:18px;line-height:28px;font-weight:700;color:${TEXT};">${escapeHtml(value)}</div>
      </div>
    </div>`;
}

function routeWeatherCards(input: CommuteEmailTemplateInput) {
  const route = routeParts(input.routeTitle);
  const weather = weatherParts(input.weatherSummary);

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:32px;">
      <div style="border:1px solid ${OUTLINE};border-radius:12px;padding:16px;">
        <div style="font-size:14px;line-height:20px;color:${MUTED};margin-bottom:16px;">推荐路线</div>
        <div style="display:flex;align-items:center;gap:10px;font-size:16px;line-height:24px;font-weight:700;color:${TEXT};">
          ${iconSvg("train", PRIMARY_DARK, 20)}
          <span>${escapeHtml(route.primary)}</span>
        </div>
        ${
          route.secondary
            ? `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;font-size:16px;line-height:24px;color:${MUTED};">${iconSvg("bike", MUTED, 18)}<span>${escapeHtml(route.secondary)}</span></div>`
            : ""
        }
      </div>
      <div style="border:1px solid ${OUTLINE};border-radius:12px;padding:16px;">
        <div style="font-size:14px;line-height:20px;color:${MUTED};margin-bottom:16px;">目的地天气</div>
        <div style="display:flex;align-items:center;gap:12px;">
          ${iconSvg("rain", PRIMARY_DARK, 32)}
          <div>
            <div style="font-size:18px;line-height:28px;font-weight:700;color:${TEXT};">${escapeHtml(weather.temperature)}</div>
            ${
              weather.condition
                ? `<div style="font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(weather.condition)}</div>`
                : ""
            }
          </div>
        </div>
      </div>
    </div>`;
}

function actionAndFooterBlock(
  input: CommuteEmailTemplateInput,
  footerText: string,
  variant: "plain" | "band" = "plain"
) {
  const detailsUrl = normalizeHttpUrl(input.detailsUrl);
  const stopMonitoringUrl = normalizeHttpUrl(input.stopMonitoringUrl);
  const ctaRadius = variant === "band" ? "12px" : "9999px";
  const ctaMargin = variant === "band" ? 30 : 40;
  const cta = detailsUrl
    ? `
      <div style="margin-top:${ctaMargin}px;">
        <a href="${escapeHtml(detailsUrl)}" style="display:block;width:100%;box-sizing:border-box;background:${PRIMARY};color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:700;line-height:20px;padding:16px 24px;border-radius:${ctaRadius};box-shadow:0 8px 18px rgba(37,99,235,0.22);">查看实时地图</a>
      </div>`
    : "";
  const stopLink = stopMonitoringUrl
    ? `<a href="${escapeHtml(stopMonitoringUrl)}" style="display:inline-block;margin-top:18px;color:${variant === "band" ? PRIMARY_DARK : MUTED};text-decoration:underline;">停止监控此路线</a>`
    : "";

  if (variant === "band") {
    return `
      ${cta}
      <div style="margin:50px -20px 0;padding:24px 20px;background:${SURFACE_LOW};border-top:1px solid ${OUTLINE};text-align:center;font-size:12px;line-height:16px;color:${MUTED};">
        <div>${escapeHtml(footerText)}</div>
        ${stopLink}
      </div>`;
  }

  return `
    ${cta}
    <div style="margin-top:30px;text-align:center;font-size:12px;line-height:16px;color:${MUTED};">
      <div>${escapeHtml(footerText)}</div>
      ${stopLink}
    </div>`;
}

function buildPlainText(
  brand: string | null,
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
  const html = baseContainer({
    title: "通勤提醒：该出发了",
    maxWidth: 448,
    verticalMargin: 32,
    innerHtml: `
      <main style="padding:32px 24px 40px;">
        <header style="display:flex;align-items:center;gap:8px;margin-bottom:32px;">
          ${circularBrandIcon()}
          <div style="font-size:24px;line-height:32px;font-weight:700;color:${TEXT};">${escapeHtml(appName)}</div>
        </header>

        <section style="text-align:center;">
          <div style="font-size:14px;line-height:20px;font-weight:700;color:${MUTED};letter-spacing:0.12em;">行程提醒</div>
          <h1 style="margin:8px 0 8px;font-size:28px;line-height:34px;font-weight:700;color:${PRIMARY_DARK};">该出发了！</h1>
          <div style="font-size:16px;line-height:24px;color:${MUTED};">最晚出发时间: <strong style="color:${TEXT};font-weight:700;">${escapeHtml(formatBeijingTime(input.latestDepartAt))}</strong></div>
        </section>

        <section style="margin-top:40px;background:${SURFACE_LOW};border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:14px;">
          ${departureFactRow(iconSvg("clock", "#737686", 24), "预计到达时间", formatBeijingTime(input.targetArriveAt))}
          ${departureFactRow(iconSvg("timer", "#737686", 24), "预计行程时间", formatMinutes(input.totalMinutes))}
          ${departureFactRow(iconSvg("pin", "#737686", 24), "目的地", input.destinationName, false)}
        </section>

        ${routeWeatherCards(input)}
        ${actionAndFooterBlock(input, "此为自动发送的行程提醒邮件。")}
      </main>
    `,
  });

  return {
    subject: "通勤提醒：该出发了",
    text: buildPlainText(appName, "该出发了", input),
    html,
  };
}

function durationHtml(minutes: number | null | undefined) {
  const value = roundedMinutes(minutes);

  if (value === null) return "待确认";

  return `${value} <span style="font-size:16px;line-height:24px;font-weight:400;color:${MUTED};">分钟</span>`;
}

function routeChangeDetailCard(input: CommuteEmailTemplateInput) {
  const route = routeParts(input.routeTitle);
  const weather = weatherParts(input.weatherSummary);

  return `
    <section style="margin-top:24px;border-radius:8px;background:${SURFACE_CARD};box-shadow:0 4px 12px rgba(0,0,0,0.05);padding:12px 16px;">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid ${OUTLINE};padding-bottom:12px;">
        <div>
          <div style="font-size:12px;line-height:16px;color:${MUTED};letter-spacing:0.05em;">目的地</div>
          <div style="margin-top:6px;font-size:18px;line-height:28px;font-weight:700;color:${TEXT};">${escapeHtml(input.destinationName)}</div>
          <div style="margin-top:2px;font-size:14px;line-height:20px;color:${MUTED};">${escapeHtml(valueOrPending(input.destinationAddress))}</div>
        </div>
        <div style="width:48px;height:48px;border-radius:9999px;background:#eef0f3;display:flex;align-items:center;justify-content:center;color:${PRIMARY_DARK};">${iconSvg("building", PRIMARY_DARK, 28)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-top:14px;">
        <div>
          <div style="font-size:12px;line-height:16px;color:${MUTED};letter-spacing:0.05em;">推荐路线</div>
          <div style="margin-top:6px;font-size:16px;line-height:24px;color:${TEXT};">
            <span style="color:${PRIMARY_DARK};font-weight:700;">${escapeHtml(route.primary)}</span>
            ${
              route.secondary
                ? `<span style="color:${MUTED};padding:0 8px;">→</span><span>${escapeHtml(route.secondary)}</span>`
                : ""
            }
          </div>
        </div>
        <div style="text-align:right;min-width:96px;">
          <div style="font-size:12px;line-height:16px;color:${MUTED};letter-spacing:0.05em;">目的地天气</div>
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:6px;font-size:16px;line-height:24px;color:${TEXT};">
            ${iconSvg("sun-cloud", PRIMARY_DARK, 22)}
            <span>${escapeHtml(weather.temperature)}</span>
          </div>
        </div>
      </div>
    </section>`;
}

export function buildRouteChangeEmail(
  input: RouteChangeEmailTemplateInput
): BuiltEmailTemplate {
  const appName = resolveAppName(input);
  const roundedChangeMinutes = Math.round(Math.abs(input.changeMinutes));
  const textChange = `受路况影响，出发时间变化约 ${roundedChangeMinutes} 分钟`;
  const badgeChange = `受路况影响，出发时间延后 ${roundedChangeMinutes} 分钟`;
  const previousDepartAt = formatBeijingTime(input.previousLatestDepartAt);
  const plainTextIntro = [
    textChange,
    `原最晚出发时间：${previousDepartAt}`,
  ].join("\n");
  const html = baseContainer({
    title: `通勤时间已变化：${input.tripTitle}`,
    maxWidth: 600,
    background: "#f7f9fb",
    innerHtml: `
      <header style="display:flex;align-items:center;justify-content:space-between;padding:24px 20px;border-bottom:1px solid ${OUTLINE};background:#ffffff;">
        <div style="display:flex;align-items:center;gap:10px;color:${PRIMARY_DARK};font-size:14px;line-height:20px;font-weight:700;letter-spacing:0.05em;">
          ${iconSvg("route", PRIMARY_DARK, 24)}
          <span>行程提醒</span>
        </div>
        <div style="font-size:16px;line-height:24px;font-weight:700;color:${MUTED};">${escapeHtml(appName)}</div>
      </header>
      <main style="padding:34px 20px 0;">
        <section style="text-align:center;">
          <h1 style="margin:0;font-size:28px;line-height:34px;font-weight:700;color:${TEXT};">出发时间已更新</h1>
          <div style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 14px;border-radius:9999px;background:${ERROR_CONTAINER};color:${ERROR};font-size:12px;line-height:16px;">
            ${iconSvg("clock", ERROR, 16)}
            <span>${escapeHtml(badgeChange)}</span>
          </div>
          <div style="margin-top:14px;font-size:16px;line-height:24px;color:${MUTED};">最晚出发时间</div>
          <div style="margin-top:4px;font-size:56px;line-height:64px;font-weight:700;color:${ERROR};">${escapeHtml(formatBeijingTime(input.latestDepartAt))}</div>
        </section>

        <section style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:34px;">
          <div style="border-radius:8px;background:${SURFACE_CARD};box-shadow:0 4px 12px rgba(0,0,0,0.05);padding:12px;">
            <div style="display:flex;align-items:center;gap:6px;color:${MUTED};font-size:12px;line-height:16px;">${iconSvg("flag", MUTED, 16)}<span>预计到达时间</span></div>
            <div style="margin-top:6px;font-size:24px;line-height:32px;font-weight:700;color:${TEXT};">${escapeHtml(formatBeijingTime(input.targetArriveAt))}</div>
          </div>
          <div style="border-radius:8px;background:${SURFACE_CARD};box-shadow:0 4px 12px rgba(0,0,0,0.05);padding:12px;">
            <div style="display:flex;align-items:center;gap:6px;color:${MUTED};font-size:12px;line-height:16px;">${iconSvg("timer", MUTED, 16)}<span>预计行程时间</span></div>
            <div style="margin-top:6px;font-size:24px;line-height:32px;font-weight:700;color:${TEXT};">${durationHtml(input.totalMinutes)}</div>
          </div>
        </section>

        ${routeChangeDetailCard(input)}
        ${actionAndFooterBlock(input, "此为自动发送的行程复查邮件。", "band")}
      </main>
    `,
  });

  return {
    subject: `通勤时间已变化：${input.tripTitle}`,
    text: buildPlainText(appName, "出发时间已更新", input, plainTextIntro),
    html,
  };
}
