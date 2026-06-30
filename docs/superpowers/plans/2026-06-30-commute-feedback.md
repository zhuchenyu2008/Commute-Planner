# Commute Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix history date filtering, expired trip display, home location heading, and SMTP certificate diagnostics.

**Architecture:** Keep status formatting and SMTP diagnostics in small pure helpers so server pages, client components, and tests can share behavior. Add one client-only history date filter component for auto-submit while preserving the existing server-rendered history page. Keep TLS strict by default and only add system CA certificates when explicitly configured.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Testing Library, Prisma, Nodemailer, Node TLS APIs.

---

## Visual Notes

Visual thesis: Keep the commute app calm and utility-first, with location as the main orientation signal and status badges doing quiet operational work.

Content plan: History stays a dated list; home keeps a compact location header; settings keeps operational notification feedback.

Interaction thesis: Date selection should submit immediately; status badges should update without extra user effort; notification failures should read as actionable diagnostics.

## File Structure

- Create `src/lib/trips/display-status.ts` for pure trip status labels, expired detection, and tone selection.
- Modify `src/lib/home/summary.ts` to reuse shared status labels and expired detection.
- Create `src/components/history/history-date-filter.tsx` for the auto-submitting date input.
- Modify `app/history/page.tsx` to use the date filter and shared display status.
- Modify `app/page.tsx` to move the current location value into the H1 and use expired-aware recent history dots.
- Modify `src/components/home/current-location-label.tsx` only if the H1 needs reusable class support.
- Modify `src/lib/notifications/email.ts` to add TLS system CA support and certificate error diagnostics.
- Update focused tests in `tests/unit/trip-display-status.test.ts`, `tests/unit/home-summary.test.ts`, and `tests/unit/ui-components.test.tsx`.
- Add `tests/unit/email-notifications.test.ts` for SMTP helper behavior.

### Task 1: Shared Trip Display Status

**Files:**
- Create: `src/lib/trips/display-status.ts`
- Modify: `src/lib/home/summary.ts`
- Test: `tests/unit/trip-display-status.test.ts`
- Test: `tests/unit/home-summary.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call `getTripDisplayStatus({ status: "monitoring", targetArriveAt: past, now })` and expect `{ key: "expired", label: "已过期", tone: "warning", isExpired: true }`. Update `formatHistoryTripSummary` tests so an expired monitoring trip formats as `已过期 · <destination>`.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/unit/trip-display-status.test.ts tests/unit/home-summary.test.ts`

Expected: fails because `getTripDisplayStatus` does not exist and history summaries still use raw status.

- [ ] **Step 3: Implement shared helper**

Add `src/lib/trips/display-status.ts` with `TRIP_STATUS_LABELS`, `TRIP_STATUS_TONES`, `isExpiredTripStatus`, and `getTripDisplayStatus`. Import it from `src/lib/home/summary.ts` and use it in `formatHomeTripStatus` and `formatHistoryTripSummary`.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/unit/trip-display-status.test.ts tests/unit/home-summary.test.ts`

Expected: both files pass.

### Task 2: Auto-Submit History Date Filter

**Files:**
- Create: `src/components/history/history-date-filter.tsx`
- Modify: `app/history/page.tsx`
- Test: `tests/unit/ui-components.test.tsx`

- [ ] **Step 1: Write failing test**

Render `HistoryDateFilter`, mock `HTMLFormElement.prototype.requestSubmit`, change the date input, and expect `requestSubmit` to have been called once.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/unit/ui-components.test.tsx`

Expected: fails because the component does not exist.

- [ ] **Step 3: Implement component and page usage**

Create a client component with a labeled date input. On `change`, call `event.currentTarget.form?.requestSubmit()`. Replace the inline history form in `app/history/page.tsx`; remove the visible submit button.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/unit/ui-components.test.tsx`

Expected: UI component tests pass.

### Task 3: Home Location Heading and Expired Recent History

**Files:**
- Modify: `app/page.tsx`
- Test: `tests/unit/ui-components.test.tsx`
- Test: `tests/unit/home-summary.test.ts`

- [ ] **Step 1: Write failing assertions**

Add a static markup test for the home location label component if class support is needed. Add a home summary test proving expired scheduled trips are also labelled `已过期`.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/unit/ui-components.test.tsx tests/unit/home-summary.test.ts`

Expected: fails where behavior is not yet wired.

- [ ] **Step 3: Implement page changes**

In `app/page.tsx`, keep the eyebrow text as `当前位置` and render `currentLocationName` inside the H1. In recent history mapping, compute `getTripDisplayStatus({ status: trip.status, targetArriveAt: trip.targetArriveAt })` and use `displayStatus.key` for the dot class.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/unit/ui-components.test.tsx tests/unit/home-summary.test.ts`

Expected: tests pass.

### Task 4: SMTP TLS System CA and Diagnostics

**Files:**
- Modify: `src/lib/notifications/email.ts`
- Test: `tests/unit/email-notifications.test.ts`

- [ ] **Step 1: Write failing tests**

Mock `nodemailer.createTransport`, `tls.getCACertificates`, and `tls.setDefaultCACertificates`. Assert `SMTP_TLS_USE_SYSTEM_CA=true` loads system CA certificates before transport creation. Assert an error with message `unable to verify the first certificate` is returned as a Chinese diagnostic mentioning SMTP certificate chain and `--use-system-ca`.

- [ ] **Step 2: Verify red**

Run: `npm.cmd test -- tests/unit/email-notifications.test.ts`

Expected: fails because TLS helper behavior does not exist.

- [ ] **Step 3: Implement minimal email helper changes**

Import `tls`, add a `shouldUseSystemCa` env check, call `tls.setDefaultCACertificates(tls.getCACertificates("system"))` only when configured, and map common Node certificate errors to actionable Chinese text. Keep `rejectUnauthorized` unchanged.

- [ ] **Step 4: Verify green**

Run: `npm.cmd test -- tests/unit/email-notifications.test.ts`

Expected: tests pass.

### Task 5: Final Verification and Cleanup Commit

**Files:**
- Delete: `docs/superpowers/specs/2026-06-30-commute-feedback-design.md`
- Delete: `docs/superpowers/plans/2026-06-30-commute-feedback.md`

- [ ] **Step 1: Run focused tests**

Run: `npm.cmd test -- tests/unit/trip-display-status.test.ts tests/unit/home-summary.test.ts tests/unit/ui-components.test.tsx tests/unit/email-notifications.test.ts`

Expected: all focused tests pass.

- [ ] **Step 2: Run full verification**

Run: `npm.cmd test`

Expected: all tests pass.

Run: `npm.cmd run lint`

Expected: TypeScript exits with code 0.

Run: `npm.cmd run build`

Expected: Next.js production build exits with code 0.

- [ ] **Step 3: Remove temporary Superpowers files**

Delete the design and plan files listed above before the final implementation commit, so the final `main` tree contains only product code and tests.

- [ ] **Step 4: Commit implementation**

Commit product changes and deletion of temporary docs with message `fix: address commute feedback`.

- [ ] **Step 5: Merge and clean branch**

Checkout `main`, merge `codex/commute-feedback`, run verification on merged `main`, remove `.worktrees/codex-commute-feedback`, prune worktrees, and delete local branch `codex/commute-feedback`.
