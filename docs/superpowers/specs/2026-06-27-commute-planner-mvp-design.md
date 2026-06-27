# Commute Planner MVP Design

## Goal

Build a local-first intelligent commute planning app for personal use. The app lets a signed-in user enter one natural-language request, watches an OpenAI-compatible Agent plan the trip, then stores and tracks an executable itinerary with routes, detailed buffer decisions, automatic recalculation, reminders, history, settings, notifications, and confirmable personal memories.

The first version is a complete local MVP: Next.js frontend, Prisma/SQLite persistence, Docker support, real integrations when `.env` is configured, and deterministic mock fallbacks when a key or service is unavailable.

## Chosen Approach

Use a Next.js App Router monolith with an Agent service layer. The app, API routes/server actions, Prisma database access, Agent orchestration, AMap adapters, notification adapters, and scheduler entrypoints live in one repository.

This keeps local development and Docker operation simple while preserving clear internal boundaries. Long-running planning work is isolated in the Agent runner and scheduler modules, not embedded directly in page components.

This design reflects the approved v2 flow: weather is an Agent decision tool, non-route buffer time is Agent-decided and stored as structured components, Docker support is required, Agent runs use a 10-minute timeout with retry instead of a reasoning-turn limit, and multi-stop trips are first-class.

## User Flow

The normal single-destination flow is:

1. User logs in and configures settings.
2. User enters a sentence on the homepage, for example `明天 9:15 到龙湖天街电影院`.
3. App validates the session and creates an Agent conversation.
4. User is taken to the Agent conversation page.
5. The conversation page streams or polls visible planning events: intent parsing, POI lookup, weather lookup, route calls, buffer decisions, memory reads, and final choice.
6. When the Agent completes planning, the app writes the trip and redirects to the trip detail page.
7. The trip detail page shows latest departure, route breakdown, non-route buffer components, reminder schedule, recalculation state, and notification status.
8. If the user is dissatisfied, they click the Agent conversation button on the detail page and continue the same Agent session to revise the existing trip.
9. The background scheduler checks due jobs every minute.
10. Due jobs trigger Agent-assisted recalculation and notification decisions.
11. Telegram and email reminders are sent when configured and logged.

Multi-stop requests are first-class:

- Example: `明天先去 A 拿东西，再去 B，9:15 前到`.
- A trip contains ordered stops and legs.
- Each leg has its own route candidates, selected route, segments, buffer components, latest departure/arrival targets, recalculation records, and reminder jobs.
- The Agent decides whether a reminder belongs to a leg departure, a stop handoff, or the final departure.

## Product Pages

### Login

Provide a simple local login for MVP use. The default implementation can use credentials stored in SQLite or seeded from `.env`, with session cookies. OAuth is out of scope.

### Home

Follow the provided Lumina Velocity frontend sample:

- Mobile-first, glassmorphic surfaces, Inter typography, bottom navigation.
- Primary action is the one-sentence commute input.
- After submit, create an Agent session and navigate to `/agent/[sessionId]`.
- Home can also show active trips and quick destinations.

### Agent Conversation

This page is the visible planning workspace:

- Shows user prompt and Agent decision steps.
- Shows tool-call summaries without leaking secrets.
- Shows route candidate comparisons, weather notes, and buffer reasoning.
- Shows completion state and automatic transition to trip detail.
- Supports continuing an existing trip session from the detail page.

The Agent may make broad decisions and call all exposed planning tools. The UI should make that autonomy observable and reversible.

### Trip Detail

Follow the provided trip detail sample:

- Destination or current stop title.
- Arrival target and status.
- Selected route and alternatives.
- Timeline of route segments.
- Timeline of buffer components, including non-route time such as mall entrance, walking from mall entrance to cinema, floor movement, check-in/security, transfer friction, bike pickup/parking, and weather margin.
- Reminder schedule.
- Recalculation state.
- Actions: recalculate now, change route, adjust buffer, stop monitoring, return to Agent conversation.

### History

List completed, cancelled, and monitored trips. A previous trip can be replanned, which creates a new Agent session seeded with the historical trip and memories.

### Settings

Store:

- Default city.
- Timezone.
- Default origin name and coordinates.
- Route preferences.
- AMap usage mode.
- OpenAI-compatible model configuration read from environment.
- Telegram notification target.
- Email notification recipient and SMTP configuration.
- Default reminder cadence.

### Memories

Show confirmed personal memories and pending memory candidates. The Agent can propose memories, but the user must confirm them before they become active planning context.

## Agent Architecture

### Runner

The Agent runner is responsible for planning and revisions.

- No round-count limit is imposed.
- Each Agent run has a 10-minute wall-clock timeout.
- Timeout triggers automatic retry with the same session, current state, and a retry marker.
- Retries stop when the run succeeds or the configured retry limit/time budget is reached for the job. The retry limit is for job attempts, not Agent reasoning turns.
- All tool calls and decisions are logged.

### Tools Exposed To Agent

The Agent receives broad tool access:

- Read user profile/settings.
- Read confirmed memories.
- Propose memory candidates.
- Search AMap POIs.
- Fetch AMap POI details.
- Fetch AMap weather.
- Query AMap transit routes.
- Query AMap walking routes.
- Query AMap bicycling routes.
- Estimate structured buffer components.
- Create/update trips.
- Create/update stops and legs.
- Create/update route candidates and route segments.
- Create/update reminder jobs.
- Create notification logs.
- Trigger Telegram/email notification adapters.
- Mark trips, legs, and reminders as monitored, paused, done, or cancelled.

Weather is a decision input, not just display data. The Agent uses it to rank route candidates and choose additional buffers. Rain, wind, heat, cold, and severe weather can down-rank cycling or walking and increase transfer/arrival buffers.

### Time Model

The Agent must separate route time from non-route time.

Route time includes AMap transit, walking, and cycling durations.

Non-route buffer components include:

- Entering a mall or venue.
- Moving from mall entrance to cinema/shop/office.
- Elevator/escalator and floor changes.
- Ticketing, security, queueing, or check-in.
- Parking or returning a shared bike.
- Bike pickup availability friction.
- Metro transfer and platform waiting.
- Road crossing and station entrance friction.
- Weather margin.
- User preference margin.

Every buffer component stores category, minutes, reason, and whether it came from Agent inference, user setting, memory, weather, or manual user override.

## AMap Integration

AMap calls are wrapped in `lib/amap` adapters.

Required capabilities:

- Text POI search with city limit.
- POI detail lookup.
- Weather query.
- Transit integrated directions.
- Walking directions.
- Bicycling directions.

The AMap layer enforces a global throttle of at most 3 requests per second. All Agent tool calls must pass through that queue.

If `.env` contains valid AMap configuration, calls use the real Web Service. If a key is missing or the service fails, the tool returns a logged mock response suitable for local UI and test flows.

## Data Model

Core Prisma entities:

- `User`: account identity.
- `Session`: auth/session records.
- `UserSettings`: city, timezone, origin, route preferences, notification settings.
- `AgentSession`: conversation and run state.
- `AgentMessage`: user, assistant, system, and tool summary messages.
- `AgentToolCall`: tool name, request summary, response summary, status, duration, error.
- `Trip`: top-level itinerary.
- `TripStop`: ordered destinations or intermediate stops.
- `TripLeg`: travel between origin/stop pairs.
- `RouteCandidate`: one possible route for a leg.
- `RouteSegment`: walking, transit, bike, wait, transfer, venue, or buffer segment.
- `BufferComponent`: named non-route time component with Agent reason.
- `ReminderJob`: scheduled recalculation/reminder jobs.
- `RecalculationLog`: each automatic or manual recheck.
- `NotificationLog`: Telegram/email attempts and results.
- `Memory`: confirmed user memory.
- `MemoryCandidate`: Agent-proposed memory awaiting confirmation.

Trip status values include `planning`, `active`, `monitoring`, `completed`, `cancelled`, and `failed`.

Reminder status values include `scheduled`, `running`, `sent`, `skipped`, `failed`, and `cancelled`.

## Scheduler

The scheduler runs once per minute, either through a Next.js API endpoint or a dedicated Node command in Docker.

It finds due reminder jobs and processes them with locking to avoid duplicate sends.

For each due job:

1. Load trip, leg, selected candidate, settings, and memories.
2. Run Agent-assisted recalculation with weather and route tools.
3. Update ETA, buffer components, route status, and latest departure when needed.
4. Send notifications when the Agent decides action is needed.
5. Log all recalculation and notification outcomes.

Default cadence for single-leg trips is T-30, T-20, T-15, T-10, T-5, T. Multi-stop trips create reminder jobs for each leg and stop handoff.

If the requested arrival time is already in the past, planning should not create future reminder jobs. The Agent should surface the issue and ask for a new target time in the conversation.

## Notifications

Telegram and email are optional but supported when configured.

Notification content prioritizes action:

- Leave now.
- Latest departure time.
- Arrival target.
- Route summary.
- Weather and buffer notes.

Every notification attempt writes a `NotificationLog`. Duplicate departure reminders are suppressed through stable dedupe keys.

## Docker

Provide Docker support for local and deployed operation:

- `Dockerfile` builds the Next.js app.
- `docker-compose.yml` starts the web app with a persisted SQLite volume.
- A scheduler command or service runs the minute tick.
- `.env` is mounted or passed through but never committed.
- Prisma migration and seed commands are documented.

SQLite data should live under a mounted `data/` directory.

## Frontend Design Requirements

Use the provided frontend samples and design tokens:

- Lumina Velocity visual language.
- Inter typography.
- Commute Blue primary action color.
- Glass surfaces for major commute cards.
- Mobile-first bottom navigation and desktop top navigation.
- Avoid marketing landing pages; the first screen is the working commute input.
- Use icons for navigation and actions.
- Keep operational UI dense but readable.

Pages should be implemented as real application surfaces, not static mockups.

## Testing Strategy

Use TDD for behavior-heavy code:

- Natural-language intent parser fallbacks.
- AMap throttle.
- Agent run timeout and retry policy.
- Buffer component calculation helpers.
- Trip/stop/leg persistence.
- Reminder job creation.
- Scheduler due-job locking.
- Notification dedupe.
- Mock fallback behavior.

Integration tests should verify a complete local flow with mock services:

1. Login.
2. Submit a sentence.
3. Create Agent session.
4. Produce trip with selected route and buffer components.
5. Create reminder jobs.
6. Recalculate a due reminder.
7. Log a notification.

UI tests should verify:

- Home input navigation.
- Agent conversation progress.
- Completion redirect to trip detail.
- Detail button returns to the Agent session.
- Multi-stop trips render stops and legs.

## Out Of Scope For MVP

- Production OAuth.
- Native mobile app.
- Real-time vehicle location.
- Payment or ride-hailing integration.
- Multi-user admin console.
- Cloud database migration beyond SQLite.

## Implementation Decisions

- The Agent conversation page will use polling persisted `AgentMessage` and `AgentToolCall` records for the MVP. If streaming is added after the MVP, it must reuse the same database model.
- Real AMap responses should be normalized into stable internal DTOs before the Agent sees them.
- Mock providers must be deterministic so tests do not depend on network state.
- The app must not read or expose `.env` values in the UI or logs.
