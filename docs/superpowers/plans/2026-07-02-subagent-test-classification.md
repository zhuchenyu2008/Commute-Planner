# Subagent Test Classification

Beijing Time: 2026-07-02

Scope: remaining cases from RUS-015 through RUS-038 in `2026-07-02-real-user-commute-test-plan.md`.

## Classification Rules

- Parallelize cases that can use isolated SQLite files, isolated ports, and no shared external side effects.
- Keep cases that send real Telegram/SMTP messages or mutate real Telegram bot state under the main controller.
- Do not use `npm.cmd run test:e2e` for real AMap/OpenAI verification because `scripts/e2e.mjs` clears real API credentials.
- For real API verification, run Playwright directly with a dedicated `DATABASE_URL`, `PLAYWRIGHT_BASE_URL`, and port.
- Every completed case must be recorded in `2026-07-02-real-user-scenario-results.md`, then checked off in the plan checklist.

## Serial Main-Controller Tests

These should not be parallelized because they share real external channels, bot state, or the production-like test server.

| Cases | Reason | Owner |
| --- | --- | --- |
| RUS-015 Departure reminder | Scheduler tick can send real email/Telegram and must prove notification dedupe without duplicate sends. | Main controller |
| RUS-019 Notification test buttons, success paths | Real Telegram/SMTP button sends should be serialized to avoid duplicate outbound messages. Negative/config-validation cases may be delegated. | Main controller plus subagent negative coverage |
| RUS-026 through RUS-031 Telegram real-use scenarios | Real bot token, chat id, polling offset, callback state, and real AI/AMap planning are shared external state. | Main controller |
| Any live AMap/OpenAI end-to-end rerun | Expensive, rate-limited, and depends on the same credentials. | Main controller |

## Parallel Subagent Batches

### Batch A: Monitoring and Scheduler Without Real Delivery

Cases: RUS-016, RUS-034

Allowed work:
- Add or run deterministic integration/e2e tests for cancel monitoring and notification dedupe.
- Use mocked notification senders or skipped delivery config.
- Use an isolated test database, for example `file:./subagent-a-scheduler.db`.

Do not:
- Send real Telegram or SMTP messages.
- Reuse `e2e-real-api.db`.

### Batch B: Settings, Place Search, and Notification Negative Paths

Cases: RUS-017, RUS-018, RUS-019 negative/config-failure paths

Allowed work:
- Test settings validation through APIs and UI.
- Test place search empty keyword, mocked AMap result, configured live AMap read-only search, and failure handling.
- Test notification button disabled/loading/error states without successful real outbound sends.
- Use an isolated database and port if browser coverage is needed.

Do not:
- Trigger real Telegram/SMTP success sends.

### Batch C: Agent Guards, Failure Handling, Security, and Invalid APIs

Cases: RUS-020, RUS-021, RUS-032, RUS-033

Allowed work:
- Use integration tests and browser tests with stubbed Agent clients where possible.
- Verify duplicate running-session conflicts, empty continuation validation, failure/timeout persistence, cross-user isolation, and stable JSON errors.
- Use isolated databases only.

Do not:
- Run real OpenAI/AMap planning unless the main controller asks for a specific final rerun.

### Batch D: History, Memories, Home, and Trip Detail Data Shapes

Cases: RUS-022, RUS-023, RUS-024, RUS-025

Allowed work:
- Seed deterministic trips, memories, reminders, candidates, and recalculation logs.
- Verify Beijing-day history boundaries and page rendering.
- Use isolated browser server and database.

Do not:
- Depend on live AI, AMap, Telegram, or SMTP.

### Batch E: Responsive, Overflow, Keyboard, and Focus

Cases: RUS-035, RUS-036, RUS-037, RUS-038

Allowed work:
- Run Playwright viewport and keyboard checks against deterministic seeded data.
- Capture screenshots only if needed for diagnosis.
- Use isolated browser server and database.

Do not:
- Modify unrelated visual design while testing unless a defect blocks the scenario.

### Batch F: Telegram Deterministic Handler Coverage

Cases: RUS-026 through RUS-031 deterministic companion coverage

Allowed work:
- Test Telegram handler/state logic with mocked Telegram client and stubbed Agent/Amap clients.
- Verify binding, `/new`, awaiting prompt, continuation guard, trip switching, `/status`, and `/cancel` without real outbound Telegram calls.

Do not:
- Poll the real Telegram API.
- Reuse real Telegram offsets or chat ids unless explicitly provided by the main controller.

## Current Dispatch Plan

1. Dispatch Batch A, Batch C, and Batch D first because they are high-value and isolated.
2. Keep RUS-015 in the main thread and finish it before real notification button tests.
3. Dispatch Batch B and Batch E after the first wave if port and CPU load are stable.
4. Use Batch F as deterministic companion coverage before the serialized real Telegram run.
