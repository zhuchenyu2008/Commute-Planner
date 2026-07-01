# Email Templates And Page Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sample-aligned commute notification emails, send two real template test emails through the configured recipient, and make the home-to-Agent route feel continuous.

**Architecture:** Keep email rendering in a focused server-only template module that returns `subject`, `text`, and `html`. The scheduler keeps Telegram/log content as text while passing richer HTML to email. Page transitions use small client utilities, CSS View Transitions when available, and reduced-motion fallbacks without adding an animation dependency.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Vitest, Testing Library, Prisma, nodemailer.

---

## File Structure

- Create `src/lib/notifications/email-templates.ts`: pure template builders, formatting helpers, and HTML escaping.
- Modify `src/lib/notifications/email.ts`: allow optional `html` and forward it to nodemailer.
- Modify `src/lib/scheduler/process-job.ts`: build template inputs from due jobs and pass HTML emails to `sendEmail`.
- Create `src/lib/notifications/test-email-samples.ts`: sample data used by the real test-email script.
- Create `scripts/send-test-emails.ts`: read current configured email recipient from Prisma and send both template emails through `sendEmail`.
- Create `src/lib/ui/agent-transition.ts`: sessionStorage and View Transition helpers.
- Modify `src/components/home/commute-input.tsx`: save pending prompt and route via transition helper.
- Modify `src/components/agent/agent-event-list.tsx`: render the first user request as a user message bubble and attach shared transition styling.
- Modify `src/components/app-shell.tsx`, `src/components/bottom-nav.tsx`, and `app/globals.css`: add restrained page/nav motion and reduced-motion rules.
- Add tests in `tests/unit/email-notifications.test.ts`, `tests/unit/email-templates.test.ts`, `tests/unit/test-email-samples.test.ts`, `tests/unit/agent-transition.test.ts`, `tests/unit/ui-components.test.tsx`, and `tests/integration/scheduler.test.ts`.

---

### Task 1: Allow HTML Email Bodies

**Files:**
- Modify: `src/lib/notifications/email.ts`
- Test: `tests/unit/email-notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("email notifications", ...)` in `tests/unit/email-notifications.test.ts`:

```ts
  it("passes html bodies to nodemailer when provided", async () => {
    setCompleteSmtpEnv();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockResolvedValue({});

    const result = await sendEmail({
      to: "receiver@example.com",
      subject: "HTML test",
      text: "Plain text fallback",
      html: "<p>HTML body</p>",
    });

    expect(result).toMatchObject({
      status: "sent",
      recipient: "receiver@example.com",
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "sender@example.com",
        to: "receiver@example.com",
        subject: "HTML test",
        text: "Plain text fallback",
        html: "<p>HTML body</p>",
      })
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/unit/email-notifications.test.ts -t "passes html bodies to nodemailer when provided"
```

Expected: FAIL with a TypeScript or assertion failure because `EmailSendInput` does not accept `html` or `sendMail` does not receive it.

- [ ] **Step 3: Add minimal HTML support**

Update `src/lib/notifications/email.ts`:

```ts
export type EmailSendInput = {
  to?: string | null;
  subject: string;
  text: string;
  html?: string;
};
```

Update the `sendEmail` signature and `sendMail` call:

```ts
export async function sendEmail({
  to,
  subject,
  text,
  html,
}: EmailSendInput): Promise<NotificationSendResult> {
  // keep existing setup

  await transporter.sendMail({
    from,
    to: toAddress,
    subject,
    text,
    ...(html ? { html } : {}),
  });

  return { status: "sent", recipient };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
npm test -- tests/unit/email-notifications.test.ts -t "passes html bodies to nodemailer when provided"
```

Expected: PASS.

- [ ] **Step 5: Run the full email notification test file**

Run:

```bash
npm test -- tests/unit/email-notifications.test.ts
```

Expected: PASS. Existing CA and certificate diagnostic tests still pass.

---

### Task 2: Add Sample-Aligned Email Template Builders

**Files:**
- Create: `src/lib/notifications/email-templates.ts`
- Create: `tests/unit/email-templates.test.ts`

- [ ] **Step 1: Write failing template tests**

Create `tests/unit/email-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
} from "@/lib/notifications/email-templates";

const baseInput = {
  appName: "AI Commute",
  tripTitle: "家到科技园",
  destinationName: "科技园区A座",
  destinationAddress: "创新大道 123 号",
  latestDepartAt: new Date("2026-07-01T00:35:00.000Z"),
  targetArriveAt: new Date("2026-07-01T01:15:00.000Z"),
  totalMinutes: 40,
  routeTitle: "地铁 4 号线 -> 共享单车",
  weatherSummary: "以行程详情为准",
  detailsUrl: "/trips/trip-1",
  stopMonitoringUrl: "/trips/trip-1",
} as const;

describe("email templates", () => {
  it("builds a departure reminder email with sample-aligned content", () => {
    const email = buildDepartureReminderEmail(baseInput);

    expect(email.subject).toBe("通勤提醒：该出发了");
    expect(email.text).toContain("该出发了");
    expect(email.text).toContain("最晚出发时间：08:35");
    expect(email.text).toContain("科技园区A座");
    expect(email.html).toContain("AI Commute");
    expect(email.html).toContain("该出发了");
    expect(email.html).toContain("08:35");
    expect(email.html).toContain("预计到达时间");
    expect(email.html).toContain("查看实时地图");
    expect(email.html).toContain("/trips/trip-1");
  });

  it("builds a route change email that emphasizes the changed departure time", () => {
    const email = buildRouteChangeEmail({
      ...baseInput,
      changeMinutes: 5,
      previousLatestDepartAt: new Date("2026-07-01T00:30:00.000Z"),
    });

    expect(email.subject).toBe("通勤时间已变化：家到科技园");
    expect(email.text).toContain("出发时间已更新");
    expect(email.text).toContain("变化约 5 分钟");
    expect(email.text).toContain("最晚出发时间：08:35");
    expect(email.html).toContain("出发时间已更新");
    expect(email.html).toContain("受路况影响，出发时间变化约 5 分钟");
    expect(email.html).toContain("08:35");
    expect(email.html).toContain("Lumina Velocity");
  });

  it("escapes user-controlled text in html while keeping readable plain text", () => {
    const email = buildDepartureReminderEmail({
      ...baseInput,
      destinationName: "<script>alert(1)</script>",
      routeTitle: "地铁 <4> 号线",
    });

    expect(email.text).toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("地铁 &lt;4&gt; 号线");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- tests/unit/email-templates.test.ts
```

Expected: FAIL because `src/lib/notifications/email-templates.ts` does not exist.

- [ ] **Step 3: Create the template module**

Create `src/lib/notifications/email-templates.ts` with these exports and helpers:

```ts
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
```

Add `buildDepartureReminderEmail` with the sample structure:

```ts
export function buildDepartureReminderEmail(
  input: CommuteEmailTemplateInput
): BuiltEmailTemplate {
  const appName = input.appName ?? "AI Commute";
  const latestDepart = formatBeijingTime(input.latestDepartAt);
  const arrival = formatBeijingTime(input.targetArriveAt);
  const duration = formatMinutes(input.totalMinutes);
  const destination = input.destinationName || input.tripTitle;
  const route = input.routeTitle || "查看行程详情";
  const weather = input.weatherSummary || "以行程详情为准";
  const detailsUrl = normalizeUrl(input.detailsUrl);
  const stopUrl = normalizeUrl(input.stopMonitoringUrl);
  const subject = "通勤提醒：该出发了";
  const text = [
    "该出发了",
    `最晚出发时间：${latestDepart}`,
    `预计到达时间：${arrival}`,
    `预计行程时间：${duration}`,
    `目的地：${destination}`,
    `推荐路线：${route}`,
    `目的地天气：${weather}`,
    `查看实时地图：${detailsUrl}`,
    `停止监控此路线：${stopUrl}`,
  ].join("\n");

  const html = baseContainer(`
    <div style="padding:40px 36px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:44px;">
        <div style="width:48px;height:48px;border-radius:999px;background:${BRAND_BLUE};color:#ffffff;text-align:center;line-height:48px;font-size:24px;">▣</div>
        <div style="font-size:36px;font-weight:700;letter-spacing:0;color:${TEXT};">${escapeHtml(appName)}</div>
      </div>
      <div style="text-align:center;margin-bottom:52px;">
        <div style="font-size:16px;font-weight:700;color:${MUTED};letter-spacing:5px;margin-bottom:14px;">行程提醒</div>
        <div style="font-size:40px;font-weight:800;color:#004ac6;line-height:48px;">该出发了！</div>
        <div style="font-size:20px;color:${MUTED};margin-top:18px;">最晚出发时间：<strong style="color:${TEXT};">${escapeHtml(latestDepart)}</strong></div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;border-radius:18px;padding:28px;margin-bottom:34px;">
        ${keyFact("预计到达时间", arrival, "◷")}
        <tr><td colspan="2" style="height:22px;border-bottom:1px solid ${OUTLINE};"></td></tr>
        <tr><td colspan="2" style="height:22px;"></td></tr>
        ${keyFact("预计行程时间", duration, "⏱")}
        <tr><td colspan="2" style="height:22px;border-bottom:1px solid ${OUTLINE};"></td></tr>
        <tr><td colspan="2" style="height:22px;"></td></tr>
        ${keyFact("目的地", destination, "⌖")}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
        <tr>
          <td style="width:50%;padding-right:12px;">
            <div style="border:1px solid ${OUTLINE};border-radius:16px;padding:20px;min-height:112px;">
              <div style="font-size:14px;color:${MUTED};margin-bottom:12px;">推荐路线</div>
              <div style="font-size:20px;font-weight:700;color:${TEXT};line-height:28px;">${escapeHtml(route)}</div>
            </div>
          </td>
          <td style="width:50%;padding-left:12px;">
            <div style="border:1px solid ${OUTLINE};border-radius:16px;padding:20px;min-height:112px;">
              <div style="font-size:14px;color:${MUTED};margin-bottom:12px;">目的地天气</div>
              <div style="font-size:20px;font-weight:700;color:${TEXT};line-height:28px;">${escapeHtml(weather)}</div>
            </div>
          </td>
        </tr>
      </table>
      <a href="${escapeHtml(detailsUrl)}" style="display:block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;text-align:center;border-radius:999px;padding:18px 20px;font-size:18px;font-weight:700;margin-bottom:40px;">查看实时地图</a>
      <div style="text-align:center;color:${MUTED};font-size:14px;line-height:24px;">
        <div>此为自动发送的行程提醒邮件。</div>
        <a href="${escapeHtml(stopUrl)}" style="display:inline-block;color:${MUTED};margin-top:16px;">停止监控此路线</a>
      </div>
    </div>`);

  return { subject, text, html };
}
```

Add `buildRouteChangeEmail`:

```ts
export function buildRouteChangeEmail(
  input: RouteChangeEmailTemplateInput
): BuiltEmailTemplate {
  const latestDepart = formatBeijingTime(input.latestDepartAt);
  const arrival = formatBeijingTime(input.targetArriveAt);
  const duration = formatMinutes(input.totalMinutes);
  const destination = input.destinationName || input.tripTitle;
  const address = input.destinationAddress || "";
  const route = input.routeTitle || "查看行程详情";
  const weather = input.weatherSummary || "以行程详情为准";
  const detailsUrl = normalizeUrl(input.detailsUrl);
  const stopUrl = normalizeUrl(input.stopMonitoringUrl);
  const roundedChange = Math.round(input.changeMinutes);
  const subject = `通勤时间已变化：${input.tripTitle}`;
  const text = [
    "出发时间已更新",
    `受路况影响，变化约 ${roundedChange} 分钟`,
    `最晚出发时间：${latestDepart}`,
    `预计到达时间：${arrival}`,
    `预计行程时间：${duration}`,
    `目的地：${destination}`,
    address ? `地址：${address}` : "",
    `推荐路线：${route}`,
    `目的地天气：${weather}`,
    `查看实时地图：${detailsUrl}`,
    `停止监控此路线：${stopUrl}`,
  ].filter(Boolean).join("\n");

  const html = baseContainer(`
    <div style="border-bottom:1px solid ${OUTLINE};padding:28px 36px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:20px;font-weight:800;color:${MUTED};"><span style="color:#004ac6;">⌘</span> 行程提醒</div>
      <div style="font-size:18px;font-weight:700;color:${MUTED};">Lumina Velocity</div>
    </div>
    <div style="padding:48px 36px 0;">
      <div style="text-align:center;margin-bottom:48px;">
        <div style="font-size:36px;font-weight:800;color:${TEXT};line-height:44px;margin-bottom:18px;">出发时间已更新</div>
        <div style="display:inline-block;border-radius:999px;background:#ffdad6;color:${ERROR};padding:8px 18px;font-size:15px;">受路况影响，出发时间变化约 ${escapeHtml(String(roundedChange))} 分钟</div>
        <div style="font-size:20px;color:${MUTED};margin-top:28px;">最晚出发时间</div>
        <div style="font-size:72px;font-weight:800;color:${ERROR};line-height:84px;margin-top:12px;">${escapeHtml(latestDepart)}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td style="width:50%;padding-right:12px;">
            <div style="background:#ffffff;border-radius:14px;padding:22px;box-shadow:0 8px 28px rgba(25,28,30,0.06);">
              <div style="font-size:14px;color:${MUTED};">预计到达时间</div>
              <div style="font-size:30px;font-weight:800;color:${TEXT};margin-top:8px;">${escapeHtml(arrival)}</div>
            </div>
          </td>
          <td style="width:50%;padding-left:12px;">
            <div style="background:#ffffff;border-radius:14px;padding:22px;box-shadow:0 8px 28px rgba(25,28,30,0.06);">
              <div style="font-size:14px;color:${MUTED};">预计行程时间</div>
              <div style="font-size:30px;font-weight:800;color:${TEXT};margin-top:8px;">${escapeHtml(duration)}</div>
            </div>
          </td>
        </tr>
      </table>
      <div style="background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 8px 28px rgba(25,28,30,0.06);margin-bottom:34px;">
        <div style="font-size:14px;color:${MUTED};margin-bottom:8px;">目的地</div>
        <div style="font-size:26px;font-weight:800;color:${TEXT};">${escapeHtml(destination)}</div>
        ${address ? `<div style="font-size:14px;color:${MUTED};margin-top:8px;">${escapeHtml(address)}</div>` : ""}
        <div style="height:1px;background:${OUTLINE};margin:24px 0;"></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:60%;vertical-align:top;">
              <div style="font-size:14px;color:${MUTED};margin-bottom:8px;">推荐路线</div>
              <div style="font-size:20px;color:${TEXT};font-weight:700;line-height:28px;">${escapeHtml(route)}</div>
            </td>
            <td style="width:40%;vertical-align:top;text-align:right;">
              <div style="font-size:14px;color:${MUTED};margin-bottom:8px;">目的地天气</div>
              <div style="font-size:20px;color:${TEXT};font-weight:700;line-height:28px;">${escapeHtml(weather)}</div>
            </td>
          </tr>
        </table>
      </div>
      <a href="${escapeHtml(detailsUrl)}" style="display:block;background:${BRAND_BLUE};color:#ffffff;text-decoration:none;text-align:center;border-radius:12px;padding:18px 20px;font-size:18px;font-weight:700;margin-bottom:48px;">查看实时地图</a>
    </div>
    <div style="background:#f2f4f6;border-top:1px solid ${OUTLINE};padding:32px 36px;text-align:center;color:${MUTED};font-size:14px;line-height:24px;">
      <div>此为自动发送的行程复查邮件。</div>
      <a href="${escapeHtml(stopUrl)}" style="display:inline-block;color:#004ac6;margin-top:16px;">停止监控此路线</a>
    </div>`);

  return { subject, text, html };
}
```

- [ ] **Step 4: Run template tests**

Run:

```bash
npm test -- tests/unit/email-templates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run type checking for the new module**

Run:

```bash
npm run lint
```

Expected: PASS. If TypeScript flags DOM-only APIs in server code, remove those APIs from `email-templates.ts`.

---

### Task 3: Connect Scheduler Notifications To Email Templates

**Files:**
- Modify: `src/lib/scheduler/process-job.ts`
- Modify: `tests/integration/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler assertions for departure HTML**

In the `"locks due departure jobs..."` test in `tests/integration/scheduler.test.ts`, add after notification assertions:

```ts
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "scheduler@example.com",
        subject: "通勤提醒：该出发了",
        text: expect.stringContaining("该出发了"),
        html: expect.stringContaining("该出发了"),
      })
    );
```

- [ ] **Step 2: Write failing scheduler assertions for route-change HTML**

In the `"notifies and refreshes future reminders..."` test, replace the existing `sendEmailMock` assertion with:

```ts
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "scheduler@example.com",
        subject: "通勤时间已变化：Home-Office",
        text: expect.stringContaining("出发时间已更新"),
        html: expect.stringContaining("出发时间已更新"),
      })
    );
```

- [ ] **Step 3: Run focused scheduler tests to verify they fail**

Run:

```bash
npm test -- tests/integration/scheduler.test.ts -t "locks due departure jobs|notifies and refreshes future reminders"
```

Expected: FAIL because scheduler still passes only text email content.

- [ ] **Step 4: Import template builders**

At the top of `src/lib/scheduler/process-job.ts`, add:

```ts
import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
  type BuiltEmailTemplate,
  type CommuteEmailTemplateInput,
} from "@/lib/notifications/email-templates";
```

- [ ] **Step 5: Add template input helpers**

Add below `formatBeijingTime`:

```ts
function absoluteAppUrl(path: string) {
  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) return path;

  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function summarizeRouteTitle(job: DueReminderJob) {
  return (
    job.leg?.selectedCandidate?.title ??
    job.leg?.routeSegments?.map((segment) => segment.title).filter(Boolean).join(" -> ") ??
    "查看行程详情"
  );
}

function getTotalMinutes(job: DueReminderJob) {
  return (
    job.leg?.selectedCandidate?.totalMinutes ??
    job.leg?.selectedCandidate?.routeMinutes ??
    null
  );
}

function buildEmailTemplateInput(job: DueReminderJob): CommuteEmailTemplateInput {
  const destination =
    job.leg?.destinationName ?? job.trip.finalStopName ?? job.trip.title;
  const tripPath = `/trips/${job.tripId}`;

  return {
    tripTitle: job.trip.title,
    destinationName: destination,
    latestDepartAt: job.leg?.latestDepartAt ?? job.scheduledFor,
    targetArriveAt: job.leg?.targetArriveAt ?? job.trip.targetArriveAt,
    totalMinutes: getTotalMinutes(job),
    routeTitle: summarizeRouteTitle(job),
    weatherSummary: "以行程详情为准",
    detailsUrl: absoluteAppUrl(tripPath),
    stopMonitoringUrl: absoluteAppUrl(tripPath),
  };
}
```

If `routeSegments` is not included in `DueReminderJob`, update `findDueReminderJobs` include shape in `src/lib/scheduler/due-jobs.ts` to include `leg.routeSegments` ordered by `order asc`, then re-run tests.

- [ ] **Step 6: Let delivery accept email HTML**

Update `deliverReminderNotification` input type:

```ts
async function deliverReminderNotification(input: {
  job: DueReminderJob;
  subject: string;
  content: string;
  email?: BuiltEmailTemplate;
  notificationKind?: string;
  notificationLegId?: string | null;
}) {
```

Update the email send call:

```ts
    sendEmail({
      to: emailRecipient,
      subject: input.email?.subject ?? input.subject,
      text: input.email?.text ?? input.content,
      html: input.email?.html,
    }).then(async (result) => {
```

Keep `writeNotificationLog({ content: input.content })` unchanged so logs remain text-only.

- [ ] **Step 7: Use templates for departure and route-change jobs**

In `processDepartureReminderJob`, replace the `subject` assignment with:

```ts
  const email = buildDepartureReminderEmail(buildEmailTemplateInput(job));
  const subject = email.subject;
```

Pass `email`:

```ts
    const deliveryResults = await deliverReminderNotification({
      job,
      subject,
      content,
      email,
    });
```

In `processRouteRecheckJob`, after `content` is built, create:

```ts
    const email = buildRouteChangeEmail({
      ...buildEmailTemplateInput(job),
      latestDepartAt: after?.latestDepartAt ?? job.leg?.latestDepartAt,
      changeMinutes,
    });
```

Pass `email`:

```ts
    const deliveryResults = await deliverReminderNotification({
      job,
      subject: email.subject,
      content,
      email,
      notificationKind: "route_change",
      notificationLegId: after?.id ?? null,
    });
```

- [ ] **Step 8: Run focused scheduler tests**

Run:

```bash
npm test -- tests/integration/scheduler.test.ts -t "locks due departure jobs|notifies and refreshes future reminders"
```

Expected: PASS.

- [ ] **Step 9: Run all scheduler tests**

Run:

```bash
npm test -- tests/integration/scheduler.test.ts
```

Expected: PASS.

---

### Task 4: Add Real Template Test Email Script

**Files:**
- Create: `src/lib/notifications/test-email-samples.ts`
- Create: `tests/unit/test-email-samples.test.ts`
- Create: `scripts/send-test-emails.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing sample email tests**

Create `tests/unit/test-email-samples.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTemplateTestEmails } from "@/lib/notifications/test-email-samples";

describe("template test emails", () => {
  it("builds one departure email and one route-change email", () => {
    const emails = buildTemplateTestEmails({
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      label: "到点提醒",
      subject: "通勤提醒：该出发了",
    });
    expect(emails[0].html).toContain("该出发了");
    expect(emails[1]).toMatchObject({
      label: "时间更新",
      subject: "通勤时间已变化：测试通勤路线",
    });
    expect(emails[1].html).toContain("出发时间已更新");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/unit/test-email-samples.test.ts
```

Expected: FAIL because `test-email-samples.ts` does not exist.

- [ ] **Step 3: Create reusable test sample builders**

Create `src/lib/notifications/test-email-samples.ts`:

```ts
import {
  buildDepartureReminderEmail,
  buildRouteChangeEmail,
  type BuiltEmailTemplate,
} from "@/lib/notifications/email-templates";

export type TemplateTestEmail = BuiltEmailTemplate & {
  label: "到点提醒" | "时间更新";
};

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
    detailsUrl: "/history",
    stopMonitoringUrl: "/settings",
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
```

- [ ] **Step 4: Run sample tests**

Run:

```bash
npm test -- tests/unit/test-email-samples.test.ts
```

Expected: PASS.

- [ ] **Step 5: Create the real-send script**

Create `scripts/send-test-emails.ts`:

```ts
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { buildTemplateTestEmails } from "@/lib/notifications/test-email-samples";

async function main() {
  const settings = await prisma.userSettings.findFirst({
    where: {
      emailRecipient: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });

  const recipient = settings?.emailRecipient?.trim();

  if (!recipient) {
    throw new Error("没有找到已配置的邮件接收人 emailRecipient。");
  }

  const emails = buildTemplateTestEmails();

  for (const email of emails) {
    const result = await sendEmail({
      to: recipient,
      subject: `[测试] ${email.subject}`,
      text: email.text,
      html: email.html,
    });

    console.log(
      `[${email.label}] ${result.status} -> ${result.recipient ?? recipient}${
        result.error ? ` (${result.error})` : ""
      }`
    );

    if (result.status !== "sent") {
      throw new Error(`${email.label}测试邮件未发送成功：${result.error ?? result.status}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 6: Add a package script**

In `package.json` scripts, add:

```json
"email:test-templates": "tsx scripts/send-test-emails.ts"
```

Keep valid JSON commas around the new entry.

- [ ] **Step 7: Run type checking**

Run:

```bash
npm run lint
```

Expected: PASS.

---

### Task 5: Add Client Transition State Utilities

**Files:**
- Create: `src/lib/ui/agent-transition.ts`
- Create: `tests/unit/agent-transition.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `tests/unit/agent-transition.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  AGENT_TRANSITION_PROMPT_KEY,
  savePendingAgentPrompt,
  takePendingAgentPrompt,
  startRouteViewTransition,
} from "@/lib/ui/agent-transition";

describe("agent transition helpers", () => {
  it("saves and consumes a pending prompt from sessionStorage", () => {
    savePendingAgentPrompt(" 去公司 ");

    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBe("去公司");
    expect(takePendingAgentPrompt()).toBe("去公司");
    expect(sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY)).toBeNull();
  });

  it("falls back to direct navigation when View Transitions are unavailable", () => {
    const navigate = vi.fn();

    startRouteViewTransition(navigate);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("uses document.startViewTransition when available", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    startRouteViewTransition(navigate);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the utility tests to verify they fail**

Run:

```bash
npm test -- tests/unit/agent-transition.test.ts
```

Expected: FAIL because `src/lib/ui/agent-transition.ts` does not exist.

- [ ] **Step 3: Create transition utilities**

Create `src/lib/ui/agent-transition.ts`:

```ts
export const AGENT_TRANSITION_PROMPT_KEY = "commute-planner:agent-prompt";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished?: Promise<void> };
};

export function savePendingAgentPrompt(prompt: string) {
  if (typeof window === "undefined") return;

  const trimmed = prompt.trim();
  if (!trimmed) return;

  window.sessionStorage.setItem(AGENT_TRANSITION_PROMPT_KEY, trimmed);
}

export function takePendingAgentPrompt() {
  if (typeof window === "undefined") return "";

  const value = window.sessionStorage.getItem(AGENT_TRANSITION_PROMPT_KEY) ?? "";
  window.sessionStorage.removeItem(AGENT_TRANSITION_PROMPT_KEY);

  return value;
}

export function startRouteViewTransition(navigate: () => void) {
  if (typeof document === "undefined") {
    navigate();
    return;
  }

  const transitionDocument = document as ViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    navigate();
    return;
  }

  transitionDocument.startViewTransition(navigate);
}
```

- [ ] **Step 4: Run utility tests**

Run:

```bash
npm test -- tests/unit/agent-transition.test.ts
```

Expected: PASS.

---

### Task 6: Animate Home Submit Into Agent User Message

**Files:**
- Modify: `src/components/home/commute-input.tsx`
- Modify: `src/components/agent/agent-event-list.tsx`
- Modify: `tests/unit/ui-components.test.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write a failing home submit transition test**

In `tests/unit/ui-components.test.tsx`, add:

```ts
  it("stores the prompt before routing from home to agent", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ sessionId: "session-1", status: "running" }, { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CommuteInput />);

    const input = screen.getByLabelText("搜索目的地");
    fireEvent.change(input, { target: { value: " 明天 9 点到公司 " } });
    fireEvent.click(screen.getByRole("button", { name: "规划" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/agent/session-1");
    });
    expect(sessionStorage.getItem("commute-planner:agent-prompt")).toBe(
      "明天 9 点到公司"
    );
  });
```

If existing labels are mojibake in the test file, update the component to use real Chinese labels and update related tests to query the real label.

- [ ] **Step 2: Write a failing Agent user-bubble test**

Add to `tests/unit/ui-components.test.tsx`:

```ts
  it("renders the initial prompt as a user message bubble on the agent page", async () => {
    sessionStorage.setItem("commute-planner:agent-prompt", "明天 9 点到公司");
    const fetchMock = vi.fn(async () =>
      Response.json({
        session: {
          id: "session-1",
          tripId: null,
          status: "running",
          prompt: "明天 9 点到公司",
          messages: [
            {
              id: "message-1",
              role: "user",
              content: "明天 9 点到公司",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          toolCalls: [],
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AgentEventList autoRedirect={false} sessionId="session-1" />
    );

    await screen.findByText("明天 9 点到公司");
    expect(container.querySelector("[data-agent-user-message]")).toBeTruthy();
    expect(
      container.querySelector("[data-agent-transition-message]")
    ).toBeTruthy();
  });
```

- [ ] **Step 3: Run focused UI tests to verify they fail**

Run:

```bash
npm test -- tests/unit/ui-components.test.tsx -t "stores the prompt before routing|renders the initial prompt as a user message bubble"
```

Expected: FAIL because transition helpers are not wired into components and the Agent prompt still renders as a summary block.

- [ ] **Step 4: Wire home submit to transition helpers**

In `src/components/home/commute-input.tsx`, import:

```ts
import {
  savePendingAgentPrompt,
  startRouteViewTransition,
} from "@/lib/ui/agent-transition";
```

Update successful routing:

```ts
      savePendingAgentPrompt(trimmedPrompt);
      startRouteViewTransition(() => router.push(result.route));
```

Add stable labels and transition attributes:

```tsx
      <div className="group relative agent-prompt-source" data-agent-transition-source>
        <input
          aria-label="搜索目的地"
          // keep existing value, onChange, placeholder
        />
```

Change the submit button so its accessible name is stable:

```tsx
        <button
          aria-label="规划"
          className="absolute right-2 top-1/2 flex h-12 min-w-12 -translate-y-1/2 items-center justify-center rounded-full bg-[#2563eb] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#004ac6] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
```

- [ ] **Step 5: Render user events as message bubbles**

In `src/components/agent/agent-event-list.tsx`, import:

```ts
import { takePendingAgentPrompt } from "@/lib/ui/agent-transition";
```

Add state:

```ts
  const [transitionPrompt, setTransitionPrompt] = useState("");
```

Add effect:

```ts
  useEffect(() => {
    setTransitionPrompt(takePendingAgentPrompt());
  }, [sessionId]);
```

Remove the standalone `输入请求` summary block. In the event rendering loop, branch user messages:

```tsx
              <div className="min-w-0 py-3">
                {event.kind === "message" && event.status === "user" ? (
                  <div
                    className="ml-auto max-w-[86%] rounded-[1.5rem] bg-[#2563eb] px-5 py-4 text-white shadow-sm agent-prompt-target"
                    data-agent-transition-message={
                      transitionPrompt && event.detail === transitionPrompt
                        ? "true"
                        : undefined
                    }
                    data-agent-user-message
                  >
                    <p className="break-words text-sm font-bold text-white/80">
                      你的请求
                    </p>
                    <p className="mt-1 break-words text-base leading-6 text-white">
                      {event.detail}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white/65 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <p className="break-words text-sm font-bold text-[#191c1e]">
                        {event.title}
                      </p>
                      <span className="shrink-0 rounded-full bg-[#f2f4f6] px-2.5 py-1 text-xs font-bold text-[#434655]">
                        {formatAgentEventStatus(event.status)}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-sm leading-6 text-[#434655]">
                      {event.detail}
                    </p>
                  </div>
                )}
              </div>
```

Keep the timeline icon column for all events so the layout remains stable.

- [ ] **Step 6: Add CSS View Transition names and fallback motion**

In `app/globals.css`, add:

```css
.agent-prompt-source {
  view-transition-name: agent-prompt;
}

.agent-prompt-target[data-agent-transition-message="true"] {
  view-transition-name: agent-prompt;
}

::view-transition-old(agent-prompt),
::view-transition-new(agent-prompt) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.agent-prompt-target {
  animation: agent-message-enter 260ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes agent-message-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-prompt-source,
  .agent-prompt-target[data-agent-transition-message="true"] {
    view-transition-name: none;
  }

  .agent-prompt-target {
    animation: none;
  }
}
```

- [ ] **Step 7: Run focused UI tests**

Run:

```bash
npm test -- tests/unit/ui-components.test.tsx -t "stores the prompt before routing|renders the initial prompt as a user message bubble"
```

Expected: PASS.

---

### Task 7: Add Restrained Global Page And Nav Motion

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/bottom-nav.tsx`
- Modify: `app/globals.css`
- Modify: `tests/unit/ui-components.test.tsx`

- [ ] **Step 1: Write failing shell/nav class tests**

Add to `tests/unit/ui-components.test.tsx` imports:

```ts
import { AppShell } from "@/components/app-shell";
```

Add tests:

```ts
  it("marks AppShell main content for page enter motion", () => {
    const html = renderToStaticMarkup(
      <AppShell active="home">
        <div>Content</div>
      </AppShell>
    );

    expect(html).toContain("page-enter");
  });

  it("marks active bottom navigation items for smooth state motion", () => {
    const html = renderToStaticMarkup(<BottomNav active="history" />);

    expect(html).toContain("nav-item-motion");
    expect(html).toContain("nav-item-active");
  });
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
npm test -- tests/unit/ui-components.test.tsx -t "page enter motion|smooth state motion"
```

Expected: FAIL because classes are not present.

- [ ] **Step 3: Add shell motion class**

In `src/components/app-shell.tsx`, update `<main>`:

```tsx
      <main className="page-enter relative z-10 mx-auto w-full max-w-6xl px-5 pb-[104px] pt-8 md:px-6 md:pb-12 md:pt-24">
        {children}
      </main>
```

- [ ] **Step 4: Add nav motion classes**

In `src/components/bottom-nav.tsx`, update the link class:

```tsx
              className={`nav-item-motion flex min-h-14 min-w-16 flex-col items-center justify-center gap-1 rounded-full px-3 py-2 text-xs font-semibold transition ${
                isActive
                  ? "nav-item-active bg-[#2563eb] text-white shadow-sm"
                  : "text-[#434655] hover:bg-white/80 hover:text-[#2563eb]"
              }`}
```

- [ ] **Step 5: Add global motion CSS**

In `app/globals.css`, add:

```css
.page-enter {
  animation: page-enter 220ms cubic-bezier(0.2, 0, 0, 1) both;
}

.nav-item-motion {
  transition:
    background-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
}

.nav-item-active {
  transform: translateY(-2px) scale(1.02);
}

@keyframes page-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-enter {
    animation: none;
  }

  .nav-item-motion,
  .nav-item-active {
    transition: none;
    transform: none;
  }
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/unit/ui-components.test.tsx -t "page enter motion|smooth state motion"
```

Expected: PASS.

---

### Task 8: Full Verification And Real Email Sending

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run relevant unit tests**

Run:

```bash
npm test -- tests/unit/email-notifications.test.ts tests/unit/email-templates.test.ts tests/unit/test-email-samples.test.ts tests/unit/agent-transition.test.ts tests/unit/ui-components.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run scheduler integration tests**

Run:

```bash
npm test -- tests/integration/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run type checking**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Build the app**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Send the two real test emails**

Run:

```bash
npm run email:test-templates
```

Expected output includes:

```text
[到点提醒] sent -> configured-recipient@example.com
[时间更新] sent -> configured-recipient@example.com
```

If the command fails with missing SMTP settings or missing `emailRecipient`, report the exact error and do not claim the real emails were sent.

- [ ] **Step 6: Inspect git diff**

Run:

```bash
git status --short
git diff -- src/lib/notifications/email.ts src/lib/notifications/email-templates.ts src/lib/scheduler/process-job.ts src/lib/notifications/test-email-samples.ts scripts/send-test-emails.ts src/lib/ui/agent-transition.ts src/components/home/commute-input.tsx src/components/agent/agent-event-list.tsx src/components/app-shell.tsx src/components/bottom-nav.tsx app/globals.css package.json tests/unit/email-notifications.test.ts tests/unit/email-templates.test.ts tests/unit/test-email-samples.test.ts tests/unit/agent-transition.test.ts tests/unit/ui-components.test.tsx tests/integration/scheduler.test.ts
```

Expected: only planned files are modified or created.

---

## Self-Review Notes

- Spec coverage: Tasks 1-4 cover HTML email templates, scheduler integration, and real two-email sending. Tasks 5-7 cover shared home-to-Agent transition, first user-message presentation, page enter motion, bottom nav feedback, and reduced-motion CSS. Task 8 covers verification and real email delivery.
- Placeholder scan: No unfinished placeholders or unspecified test steps remain.
- Type consistency: Email template functions return `BuiltEmailTemplate`; scheduler delivery accepts `BuiltEmailTemplate`; client transition key is shared between utility tests, home submit, and Agent bubble tests.
