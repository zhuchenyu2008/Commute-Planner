# AI Commute Real User Scenario Test Plan

**Created At:** 2026-07-02 15:26 Beijing Time (UTC+08:00)

**Goal:** Simulate real commuter behavior and verify every user-facing workflow, backend API, scheduler branch, and notification loop in AI Commute.

**Scope:** Login, settings, place search, single-destination route planning, multi-stop route planning, Agent conversation, time changes, route changes, trip details, history, memories, monitoring cancellation, scheduler reminders, route rechecks, Telegram entry, email/Telegram notifications, responsive UI, and data isolation.

**Primary Stack:** Next.js 15, React 19, Prisma/SQLite, Vitest, Playwright, AMap mock or live AMap, OpenAI-compatible planner or fallback planner, Nodemailer, Telegram Bot API.

---

## Execution Notes

- All date and time assertions use Beijing time, `Asia/Shanghai`.
- Run manual and automated tests with a clean test database unless the case explicitly requires existing history.
- Default seed login: `user@example.com / password`.
- Prefer deterministic tests with mock AMap and fallback planner first, then repeat selected smoke cases with real AMap/OpenAI credentials if configured.
- Capture screenshots for all high-value UI flows: login, settings, Agent planning, trip detail, history filter, memories, and mobile navigation.
- For every API case, verify both HTTP status and persisted database effects.

## Baseline Verification Commands

```bash
npm run lint
npm test
npm run build
npm run test:e2e -- tests/e2e/commute-flow.spec.ts --reporter=line --workers=1
```

Expected result: all commands complete without failures. If a command fails, record the failing test name, stack trace, and whether the failure is product behavior, test setup, or environment.

## Test Data

| Name | Value |
| --- | --- |
| Default city | Ningbo / project default city |
| Test origin | E2E Origin |
| Test origin lngLat | `121.5230315924,29.8652491273` |
| Destination A | Longhu Tianjie |
| Destination B | Foreign Affairs School |
| Stopover | Coffee shop near station |
| Telegram Chat ID | Use a test chat id only |
| Email recipient | `commute-test@example.com` or a controlled inbox |
| Route-change threshold | `3` minutes by default; also test `1` and `120` |

## Persona Coverage

| Persona | Real Need | Important Risks |
| --- | --- | --- |
| Office commuter | Arrive at work on time every weekday | Wrong departure time, stale route, missed reminder |
| Parent or caregiver | Stop at school before work | Multi-leg arrival times and reminders per leg |
| Student | Choose transit, bike, or walking by weather and habit | Preference ignored, bad weather not reflected |
| Telegram-first user | Plan and revise from chat | Wrong binding, wrong active trip, duplicate commands |
| Privacy-conscious user | Only see own trips and settings | Cross-user data leakage |

---

## P0 Critical User Journeys

### RUS-001 Login Gate and Session Persistence

**Scenario:** A returning user opens the app to plan a commute.

**Steps:**
1. Open `/` without a session.
2. Verify redirect to `/login`.
3. Submit empty form, invalid email/password, then `user@example.com / password`.
4. Refresh `/`.
5. Call logout API or logout flow if exposed.
6. Reopen `/`.

**Expected:**
- Protected pages redirect unauthenticated users to `/login`.
- Invalid credentials show a user-visible error.
- Valid credentials set an httpOnly session cookie and route to `/`.
- Refresh keeps the user logged in.
- Logout clears session; protected pages again redirect to `/login`.

### RUS-002 First-Time Setup Before Planning

**Scenario:** A new user tries to plan before selecting a default origin.

**Steps:**
1. Log in with a user whose settings have no `originName` or `originLngLat`.
2. On home, enter `明天 9:15 到龙湖天街`.
3. Submit planning.
4. Follow the settings action.
5. Search `E2E Origin` or another test origin.
6. Select a place result and save settings.
7. Return home and submit the same prompt again.

**Expected:**
- Planning is blocked until a default origin is selected from candidates.
- Settings save persists `defaultCity`, `timezone`, `originName`, `originLngLat`, and route preference.
- After setup, planning creates an Agent session and enters `/agent/:sessionId`.

### RUS-003 Single-Destination Route: Arrival-Time Planning

**Scenario:** User wants a simple route from default origin to one destination by an arrival time.

**Prompt examples:**
- `明天早上 9:15 到龙湖天街`
- `今天 18:30 到外事学校`
- `周五 8 点半到公司，尽量公交`

**Steps:**
1. Ensure default origin is configured.
2. Submit the prompt from home.
3. Observe Agent page while messages and tool calls load.
4. Wait for automatic redirect to `/trips/:tripId`.
5. Open database or API payload for the created trip.

**Expected:**
- One trip is created for the current user.
- Trip status is `monitoring`.
- There is at least one destination stop and one leg.
- The leg has origin, destination, selected route candidate, route segment, buffer components, and latest departure time.
- Reminder jobs are created using default cadence `[30,20,15,10,5,0]`.
- Trip detail displays route timeline, buffer time, reminder plan, monitoring status, and Agent conversation link.

### RUS-004 Single-Destination Route: Ambiguous or Incomplete Destination

**Scenario:** User gives a vague place or missing arrival time.

**Prompt examples:**
- `明天早上去学校`
- `去龙湖`
- `现在去附近地铁站`

**Steps:**
1. Submit each prompt.
2. Observe Agent tool calls and final state.
3. If Agent picks a destination, inspect rationale.
4. If Agent fails, inspect user-facing error.

**Expected:**
- Agent either resolves a reasonable POI with evidence or asks/fails clearly.
- The app must not create a broken trip with empty destination or missing required leg data.
- Failure state remains visible on Agent page and does not loop forever.

### RUS-005 Multi-Stop Route: School Then Office

**Scenario:** A caregiver needs to drop someone off before commuting to work.

**Prompt example:** `明天 8:10 先到外事学校，停留 10 分钟，然后 9:00 前到公司`

**Steps:**
1. Submit prompt from home.
2. Wait for trip detail.
3. Inspect stops and legs in UI and database.
4. Verify reminder jobs per leg.
5. Open history and the trip detail again.

**Expected:**
- Trip has ordered stops: origin, school, office.
- Trip has at least two legs.
- Each leg has its own origin/destination, target arrival where applicable, latest departure, segment, selected candidate, and buffers.
- Reminder jobs are tied to the correct `legId`.
- Detail page map path includes every stop in order.
- Route timeline groups display each leg separately.

### RUS-006 Multi-Stop Route: Errand Stop With Stay Duration

**Scenario:** User needs to stop for coffee or pickup before the final destination.

**Prompt example:** `明天 8:30 出门，先去地铁站附近买咖啡，大概停 8 分钟，再去龙湖天街`

**Steps:**
1. Submit prompt.
2. Verify Agent creates stopover with `plannedStayMin` or equivalent note.
3. Inspect latest departure and arrival times.
4. Confirm buffer components include route and stopover-related reasoning if created.

**Expected:**
- Stopover is represented as a distinct stop or clear leg detail.
- Stay time affects subsequent leg timing.
- User can understand the route order from trip detail.

### RUS-007 Time Change: Earlier Arrival

**Scenario:** User planned a trip, then realizes they need to arrive earlier.

**Steps:**
1. Create a single-destination trip for `明天 9:15 到龙湖天街`.
2. From trip detail, open Agent conversation.
3. Send `改成明天 8:45 前到，其他不变`.
4. Wait for continuation to complete.
5. Reopen trip detail.

**Expected:**
- Existing session accepts the message only when not running.
- Trip target arrival changes to 08:45 Beijing time.
- Latest departure moves earlier according to route plus buffer minutes.
- Scheduled reminder jobs are replaced or updated; stale scheduled reminders are not left behind.
- History still points to the same updated trip if the Agent updated the existing trip, or clearly links to the new trip if a new one was intentionally created.

### RUS-008 Time Change: Later Arrival or Delay

**Scenario:** User can leave later because the meeting was postponed.

**Steps:**
1. Create a trip for `明天 9:00 到公司`.
2. Continue Agent conversation with `会议推迟到 10:00，重新算出发时间`.
3. Verify trip detail and reminder schedule.

**Expected:**
- Target arrival changes to 10:00 Beijing time.
- Latest departure and reminders shift later.
- Prior pending reminders are deleted or marked no longer scheduled.
- UI does not display both old and new reminder schedules as active.

### RUS-009 Time Change: Relative Time

**Scenario:** User describes the change relatively, not with an exact timestamp.

**Prompt examples:**
- `提前 20 分钟到`
- `晚 15 分钟出发可以吗`
- `我现在已经晚了 10 分钟，重新规划`

**Steps:**
1. Create a baseline trip.
2. Send each relative change in Agent conversation.
3. Inspect resulting target arrival, latest departure, route rationale, and reminders.

**Expected:**
- Agent interprets relative time against the current trip context in Beijing time.
- If relative instruction is ambiguous, Agent should clarify or produce a safe update.
- No invalid date or past reminder schedule should be silently created.

### RUS-010 Route Change: Switch Travel Preference

**Scenario:** User wants to change how they travel.

**Prompt examples:**
- `改成公交地铁优先`
- `如果天气好，改成骑行`
- `不要走太多路，换一条少步行的路线`
- `我想最快到，不考虑换乘次数`

**Steps:**
1. Create baseline trip.
2. Send one route preference change.
3. Wait for continuation completion.
4. Inspect selected route candidate, route segments, mode, rationale, and buffers.

**Expected:**
- Route mode and rationale reflect the changed preference.
- Trip route is updated transactionally: stops, legs, selected candidate, segments, buffers, and reminders remain consistent.
- Detail page shows the new route without orphaned old segments.

### RUS-011 Route Change: Change Destination

**Scenario:** User selected the wrong destination or changed plans.

**Prompt examples:**
- `目的地改成外事学校`
- `不去龙湖天街了，改去宁波站，还是 9 点到`

**Steps:**
1. Create baseline trip.
2. Continue Agent conversation with destination change.
3. Inspect trip detail and history card.

**Expected:**
- Final stop and route destination update.
- Title normalizes to the new origin/destination.
- Reminder schedule is rebuilt for the new route.
- History and home latest trip show the new destination.

### RUS-012 Route Change: Add or Remove Stop

**Scenario:** User changes a single route into a multi-stop route, or removes a stop.

**Prompt examples:**
- `中途加一个咖啡店，停 5 分钟`
- `取消中途停靠，直接去公司`

**Steps:**
1. Create a single-destination trip.
2. Add a stop through Agent conversation.
3. Verify multi-leg detail.
4. Remove the stop through another Agent message.
5. Verify trip returns to one main leg.

**Expected:**
- Adding stop creates ordered stops and legs.
- Removing stop deletes scheduled reminders for removed legs.
- Trip detail never shows mismatched map path, route timeline, or reminders.

### RUS-013 Route Recheck Without Significant Change

**Scenario:** Scheduler rechecks a route, but timing difference is below the user's threshold.

**Steps:**
1. Create a trip with route-change threshold `3`.
2. Create or move a `recheck` reminder job to be due.
3. Run scheduler tick with authorized secret.
4. Stub Agent continuation so the route change is `<= 3` minutes.
5. Inspect reminder job, recalculation log, and notification log.

**Expected:**
- Recheck job is processed.
- Recalculation log status is `skipped`.
- No route-change notification is sent.
- Existing future reminders remain coherent.

### RUS-014 Route Recheck With Significant Change

**Scenario:** Traffic changes enough that the user should be alerted.

**Steps:**
1. Create a trip with route-change threshold `3`.
2. Make a due `recheck` job.
3. Stub Agent continuation so route duration or latest departure changes by more than `3` minutes.
4. Run scheduler tick.
5. Inspect trip, reminders, recalculation log, notification log, and email/Telegram payloads.

**Expected:**
- Trip route or latest departure updates.
- Future reminder schedule is refreshed from the new latest departure.
- Route-change notification is sent or logged as skipped/failed depending on channel config.
- Notification content includes changed timing and current latest departure in Beijing time.

### RUS-015 Departure Reminder

**Scenario:** It is time for the user to leave.

**Steps:**
1. Create a trip with a due `depart_now` reminder.
2. Configure email recipient and/or Telegram Chat ID.
3. Run authorized scheduler tick.
4. Check notification logs and reminder status.

**Expected:**
- Reminder job is locked and processed once.
- Email and Telegram sending are attempted independently.
- Job status resolves to `sent`, `skipped`, or `failed` from channel results.
- Duplicate scheduler ticks do not send duplicate notifications for the same dedupe key.

### RUS-016 Cancel Monitoring From Trip Detail

**Scenario:** User no longer needs alerts for a trip.

**Steps:**
1. Create a monitoring trip.
2. Open trip detail.
3. Click cancel monitoring.
4. Refresh detail.
5. Run scheduler tick after reminders become due.

**Expected:**
- Trip status becomes `cancelled`.
- Cancel button becomes disabled or shows cancelled state.
- Scheduled reminders no longer fire.
- Scheduler does not send notifications for cancelled monitoring.

---

## P1 Feature and Edge Coverage

### RUS-017 Settings Validation

**Cases:**
- Empty default city.
- Unsupported timezone.
- Unsupported route preference.
- `originName` without `originLngLat`.
- `originLngLat` without `originName`.
- Invalid lngLat format.
- Longitude outside `[-180, 180]`.
- Latitude outside `[-90, 90]`.
- Invalid email format.
- Threshold `0`, `121`, decimal, string, and blank.

**Expected:**
- Invalid saves return `400` with details.
- UI shows save failure and does not overwrite last valid settings.
- Valid save returns persisted settings.

### RUS-018 Place Search

**Cases:**
- Empty keyword.
- Normal keyword with default city.
- Normal keyword after changing default city.
- AMap mock result.
- AMap live result if configured.
- AMap failure or network failure.

**Expected:**
- Empty keyword is blocked.
- Results show name and address or lngLat.
- Selecting result fills hidden origin fields.
- Failure shows readable status without crashing the form.

### RUS-019 Notification Test Buttons

**Cases:**
- Telegram test with empty Chat ID.
- Telegram test without bot token.
- Telegram API failure.
- Telegram success.
- Email test with empty recipient.
- Email test with invalid recipient.
- Email without SMTP config.
- Email SMTP certificate failure.
- Email success.

**Expected:**
- Buttons disable while a test is running.
- Only the active channel shows loading state.
- Result text clearly communicates sent, skipped, or failed.

### RUS-020 Agent Running-State Guard

**Steps:**
1. Open conversation mode for a completed session.
2. Send a valid continuation message.
3. Immediately send another message before the first completes.
4. Try an empty continuation message.

**Expected:**
- Running session rejects duplicate continuation with conflict.
- Empty message returns validation error.
- UI disables send while running.

### RUS-021 Agent Failure and Timeout

**Cases:**
- Planner returns no `create_trip` during required planning.
- Tool call fails.
- Agent run times out.
- Agent aborts.

**Expected:**
- Agent session ends as `failed` or `timed_out`.
- Assistant failure message is persisted.
- UI stops polling terminal status and shows error.
- No partial broken trip remains if creation was aborted.

### RUS-022 History Date Filter

**Steps:**
1. Create trips on `2026-07-01 23:55`, `2026-07-02 00:05`, and `2026-07-02 23:59` Beijing time.
2. Open `/history`.
3. Select `2026-07-01`, `2026-07-02`, and `2026-07-03`.
4. Move calendar across months.

**Expected:**
- Dates are grouped by Beijing day boundaries.
- URL `date` query updates.
- Empty day shows empty state.
- Clicking a history card opens the correct trip.

### RUS-023 Memories

**Steps:**
1. Create pending memory candidates from Agent preference statements, e.g. `我以后都更喜欢公交地铁`.
2. Open memories page.
3. Confirm one candidate.
4. Ignore another candidate.
5. Try confirming or ignoring the same candidate again.

**Expected:**
- Confirmed memory appears under confirmed list.
- Ignored memory disappears from pending list.
- Repeated action returns conflict or failure.
- Home pending memory count updates.

### RUS-024 Home Summary Cards

**Cases:**
- No trips.
- Latest trip scheduled/monitoring.
- Latest trip completed.
- Latest trip cancelled.
- Latest trip failed.
- Pending memories exist.
- Confirmed memory exists.

**Expected:**
- Status label, title, description, latest minutes, recent history, and memory summary match underlying data.

### RUS-025 Trip Detail Data Shapes

**Cases:**
- Trip with no reminders.
- Trip with no selected candidate but route candidates exist.
- Trip with multiple selected candidates across legs.
- Trip with latest recalculation.
- Trip with cancelled status.

**Expected:**
- Detail page renders without crashing.
- Fallback labels are understandable.
- Monitoring status reflects trip state and latest recalculation.

---

## P1 Telegram Real-Use Scenarios

### RUS-026 Telegram Binding

**Steps:**
1. Send `/start` from unbound chat.
2. Save that Chat ID in settings.
3. Send `/start` again.
4. Create a second user trying the same Chat ID.

**Expected:**
- Unbound chat receives binding instructions.
- Bound chat receives help.
- Duplicate Chat ID is rejected in settings.

### RUS-027 Telegram New Trip

**Steps:**
1. Send `/new 明天 9 点到龙湖天街`.
2. Observe progress messages.
3. Verify active Telegram state is bound to the new Agent session and trip.
4. Check final Telegram message summary.

**Expected:**
- New planning starts.
- Final result contains route, latest departure, buffers, and reminders.
- Web app shows the same trip.

### RUS-028 Telegram `/new` Then Plain Text

**Steps:**
1. Send `/new` without prompt.
2. Send `后天 8:30 到外事学校`.
3. Inspect state and resulting trip.

**Expected:**
- Chat enters `awaiting_new_prompt`.
- Next plain text starts a new planning session.
- Mode returns to active conversation after planning.

### RUS-029 Telegram Continue Current Trip

**Steps:**
1. Create a trip through Telegram.
2. Send plain text `改成 8:45 到`.
3. Send another message while Agent is still running.

**Expected:**
- First text continues active session.
- Running session blocks duplicate message with a polite retry message.
- Web trip reflects completed continuation.

### RUS-030 Telegram Trip Switching

**Steps:**
1. Ensure user has at least two switchable trips.
2. Send `/trips`.
3. Press inline button for the second trip.
4. Send `取消监控` or another plain-text update.

**Expected:**
- `/trips` returns inline buttons.
- Callback switches active trip.
- Subsequent text applies to selected trip.
- Invalid or stale callback returns a useful answer.

### RUS-031 Telegram Cancel and Status

**Steps:**
1. Send `/status` with no active trip.
2. Create active trip.
3. Send `/status`.
4. Send `/cancel`.
5. Send `/cancel` again.

**Expected:**
- Status is clear with and without active trip.
- First cancel cancels monitoring and clears active state.
- Second cancel says there is no cancellable trip.

---

## P1 Security and Isolation

### RUS-032 Cross-User Access

**Steps:**
1. Create User A and User B.
2. User A creates settings, trip, Agent session, memory candidate, and Telegram state.
3. User B tries to access User A resources by id through pages and APIs.

**Expected:**
- User B cannot view or mutate User A resources.
- APIs return `404`, `401`, or validation failure as appropriate.
- UI redirects away from inaccessible trip detail.

### RUS-033 Invalid API Inputs

**Cases:**
- Invalid JSON body.
- Missing required body.
- Empty prompt.
- Empty Agent continuation message.
- Unknown trip id.
- Unknown session id.
- Unknown candidate id.
- Scheduler tick without secret.

**Expected:**
- API returns stable JSON error responses.
- Server logs do not expose secrets.
- No database corruption or partial writes.

### RUS-034 Notification Dedupe

**Steps:**
1. Create duplicate-looking reminders and notification attempts with same dedupe key.
2. Process due jobs repeatedly.

**Expected:**
- Unique dedupe keys prevent duplicate logs or sends.
- Re-running scheduler does not resend already processed reminder jobs.

---

## P2 Responsive and Accessibility Coverage

### RUS-035 Desktop Navigation

**Viewports:** `1440x900`, `1280x720`.

**Expected:**
- Top navigation is visible.
- Active nav state is correct on home/history/memories/settings.
- Long page content does not hide behind fixed header.

### RUS-036 Mobile Navigation

**Viewports:** `390x844`, `375x667`, `430x932`.

**Expected:**
- Bottom nav is visible and usable.
- Main content does not hide behind bottom nav.
- Planning input, settings form, Agent timeline, history calendar, and trip detail fit without horizontal scrolling.

### RUS-037 Long Text and Overflow

**Cases:**
- Very long destination name.
- Long Agent reply.
- Long Telegram Chat ID.
- Long email address.
- Multi-leg route with long stop names.

**Expected:**
- Text wraps or truncates professionally.
- Buttons keep stable dimensions.
- Cards and lists do not overlap.

### RUS-038 Keyboard and Focus

**Steps:**
1. Navigate login form with keyboard only.
2. Use settings select controls with Enter, Space, Escape.
3. Use history date picker with keyboard.
4. Submit forms with Enter.

**Expected:**
- Focus is visible.
- Controls can be opened, selected, and dismissed.
- No keyboard trap.

---

## Automation Backlog

### Existing Automated Coverage to Keep

- `tests/e2e/commute-flow.spec.ts`: login, home prompt, Agent planning, trip detail, Agent conversation link.
- Unit and integration tests under `tests/unit` and `tests/integration`.

### Recommended New Playwright Specs

| Spec File | Scenarios |
| --- | --- |
| `tests/e2e/settings-onboarding.spec.ts` | RUS-002, RUS-017, RUS-018 |
| `tests/e2e/single-route.spec.ts` | RUS-003, RUS-004 |
| `tests/e2e/multi-stop-route.spec.ts` | RUS-005, RUS-006 |
| `tests/e2e/agent-route-edits.spec.ts` | RUS-007 through RUS-012 |
| `tests/e2e/trip-monitoring.spec.ts` | RUS-013 through RUS-016 |
| `tests/e2e/history-memories.spec.ts` | RUS-022, RUS-023, RUS-024 |
| `tests/e2e/responsive.spec.ts` | RUS-035 through RUS-038 |

### Recommended Integration Tests

| Test Area | Scenarios |
| --- | --- |
| Agent continuation | Time changes, route preference changes, destination changes |
| Route replacement | Add/remove stop, rebuild reminders, delete stale scheduled reminders |
| Scheduler | No-change recheck, route-change recheck, departure reminder, stale jobs |
| Telegram handler | Binding, `/new`, continuation, `/trips`, callback switching, `/cancel` |
| Security | Cross-user isolation for trips, sessions, settings, candidates |

---

## Manual Test Run Checklist

- [x] RUS-001 Login gate and session persistence
- [x] RUS-002 First-time setup before planning
- [x] RUS-003 Single-destination route: arrival-time planning
- [x] RUS-004 Single-destination route: ambiguous or incomplete destination
- [x] RUS-005 Multi-stop route: school then office
- [x] RUS-006 Multi-stop route: errand stop with stay duration
- [x] RUS-007 Time change: earlier arrival
- [x] RUS-008 Time change: later arrival or delay
- [x] RUS-009 Time change: relative time
- [x] RUS-010 Route change: switch travel preference
- [x] RUS-011 Route change: change destination
- [x] RUS-012 Route change: add or remove stop
- [x] RUS-013 Route recheck without significant change
- [x] RUS-014 Route recheck with significant change
- [x] RUS-015 Departure reminder
- [x] RUS-016 Cancel monitoring from trip detail
- [x] RUS-017 Settings validation
- [x] RUS-018 Place search
- [x] RUS-019 Notification test buttons
- [x] RUS-020 Agent running-state guard
- [x] RUS-021 Agent failure and timeout
- [x] RUS-022 History date filter
- [x] RUS-023 Memories
- [x] RUS-024 Home summary cards
- [x] RUS-025 Trip detail data shapes
- [x] RUS-026 Telegram binding
- [x] RUS-027 Telegram new trip
- [x] RUS-028 Telegram `/new` then plain text
- [x] RUS-029 Telegram continue current trip
- [x] RUS-030 Telegram trip switching
- [x] RUS-031 Telegram cancel and status
- [x] RUS-032 Cross-user access
- [x] RUS-033 Invalid API inputs
- [x] RUS-034 Notification dedupe
- [x] RUS-035 Desktop navigation
- [x] RUS-036 Mobile navigation
- [x] RUS-037 Long text and overflow
- [x] RUS-038 Keyboard and focus

## Result Template

Use this format when executing each case:

```text
Case:
Environment:
Tester:
Beijing Time:
Preconditions:
Steps Executed:
Expected:
Actual:
Result: Pass / Fail / Blocked
Evidence: screenshot path, trace path, logs, database rows
Defects:
Follow-up:
```
