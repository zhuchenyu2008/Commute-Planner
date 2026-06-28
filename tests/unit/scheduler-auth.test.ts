import { describe, expect, it } from "vitest";
import { isSchedulerAuthorized } from "@/lib/scheduler/auth";

describe("scheduler tick authorization", () => {
  it("allows local ticks when no shared secret is configured", () => {
    const request = new Request("http://localhost/api/scheduler/tick", {
      method: "POST",
    });

    expect(isSchedulerAuthorized(request, {})).toBe(true);
  });

  it("requires a matching bearer token when a shared secret is configured", () => {
    const authorized = new Request("http://localhost/api/scheduler/tick", {
      method: "POST",
      headers: { authorization: "Bearer secret-123" },
    });
    const unauthorized = new Request("http://localhost/api/scheduler/tick", {
      method: "POST",
    });

    expect(
      isSchedulerAuthorized(authorized, { SCHEDULER_TICK_SECRET: "secret-123" })
    ).toBe(true);
    expect(
      isSchedulerAuthorized(unauthorized, {
        SCHEDULER_TICK_SECRET: "secret-123",
      })
    ).toBe(false);
  });
});
