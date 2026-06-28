# Agent Tool Calling Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed commute planner with an AI-led planner that calls AMap and persistence tools until it decides the final trip.

**Architecture:** Keep `runWithTimeoutAndRetry` as the only wall-clock control. Add an injectable chat client, expose settings, memories, all AMap methods, and `create_trip` as tools, and loop on model tool calls without a round limit. The application validates and persists the AI's final structured `create_trip` arguments but does not rank routes or add fixed buffers.

**Tech Stack:** Next.js, TypeScript, Prisma, OpenAI-compatible chat completions, Vitest.

---

### Task 1: Failing Agent-Led Planning Test

**Files:**
- Modify: `tests/integration/agent-session.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that injects a scripted chat client into `runPlanningSession`. The fake model must request AMap tools, compare multiple route modes, and call `create_trip` with a bicycling selection and AI-chosen buffer components.

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- tests/integration/agent-session.test.ts`

Expected: FAIL because the current planner ignores the chat client, only calls the hard-coded transit path, and does not expose AI tool-call control.

### Task 2: Chat Client Boundary

**Files:**
- Create: `src/lib/agent/chat-client.ts`
- Modify: `src/lib/agent/types.ts`

- [ ] **Step 1: Define minimal chat client types**

Create typed messages, tool calls, tool definitions, and completion result types that can be backed by OpenAI or tests.

- [ ] **Step 2: Add the default OpenAI-compatible client**

Use the `openai` package when `OPENAI_API_KEY` is configured. Use `OPENAI_MODEL` when provided and a conservative default otherwise.

- [ ] **Step 3: Add deterministic fallback chat client**

When no OpenAI key is present, return a clearly marked mock chat client that still uses the same tool-call loop.

### Task 3: Tool-Calling Planner

**Files:**
- Modify: `src/lib/agent/planner.ts`

- [ ] **Step 1: Replace fixed planner flow**

Remove destination extraction, fixed transit choice, and fixed buffer construction from `runPlanningAttempt`.

- [ ] **Step 2: Build tool definitions**

Expose `read_settings`, `read_memories`, `search_poi`, `get_poi_detail`, `get_weather_reference`, `get_transit_route`, `get_walking_route`, `get_bicycling_route`, and `create_trip`.

- [ ] **Step 3: Execute model-requested tools**

Parse each model tool call, record it through `AgentToolCall`, return raw tool results to the model, and continue until the model calls `create_trip`.

- [ ] **Step 4: Persist AI-created trip**

Convert AI date strings to `Date`, pass AI-selected stops and legs to `createPlannedTrip`, and return the created trip id.

### Task 4: Verification

**Files:**
- Modify only files required by failures.

- [ ] **Step 1: Run focused integration test**

Run: `npm run test -- tests/integration/agent-session.test.ts`

Expected: PASS.

- [ ] **Step 2: Run related unit tests**

Run: `npm run test -- tests/unit/agent-runner.test.ts tests/unit/amap-client.test.ts`

Expected: PASS.

- [ ] **Step 3: Run type check**

Run: `npm run lint`

Expected: PASS.
