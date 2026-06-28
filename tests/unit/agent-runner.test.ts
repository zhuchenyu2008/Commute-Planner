import { describe, expect, it } from "vitest";
import { runWithTimeoutAndRetry } from "@/lib/agent/runner";

describe("runWithTimeoutAndRetry", () => {
  it("retries after a timed-out attempt and returns the next successful result", async () => {
    let attempts = 0;

    const result = await runWithTimeoutAndRetry({
      timeoutMs: 10,
      maxAttempts: 2,
      run: async ({ attempt, signal }) => {
        attempts += 1;

        expect(attempt).toBe(attempts);

        if (attempt === 1) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 50);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true }
            );
          });
          signal.throwIfAborted();
        }

        return "planned";
      },
    });

    expect(result).toEqual({
      value: "planned",
      attempts: 2,
      timedOutAttempts: 1,
    });
    expect(attempts).toBe(2);
  });

  it("retries after timeout even when the attempt ignores abort signals", async () => {
    let attempts = 0;

    const result = await runWithTimeoutAndRetry({
      timeoutMs: 10,
      maxAttempts: 2,
      run: async () => {
        attempts += 1;

        if (attempts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        return "retried";
      },
    });

    expect(result).toEqual({
      value: "retried",
      attempts: 2,
      timedOutAttempts: 1,
    });
    expect(attempts).toBe(2);
  });

  it("does not retry non-timeout failures", async () => {
    let attempts = 0;

    await expect(
      runWithTimeoutAndRetry({
        timeoutMs: 100,
        maxAttempts: 3,
        run: async () => {
          attempts += 1;
          throw new Error("tool failed");
        },
      })
    ).rejects.toThrow("tool failed");

    expect(attempts).toBe(1);
  });

  it("does not retry abort errors that were not caused by the runner timeout", async () => {
    let attempts = 0;

    await expect(
      runWithTimeoutAndRetry({
        timeoutMs: 100,
        maxAttempts: 3,
        run: async () => {
          attempts += 1;
          throw new DOMException("cancelled elsewhere", "AbortError");
        },
      })
    ).rejects.toThrow("cancelled elsewhere");

    expect(attempts).toBe(1);
  });

  it("has no round-limit option or result concept", async () => {
    type RunnerOptions = Parameters<typeof runWithTimeoutAndRetry<string>>[0];
    type RunnerResult = Awaited<ReturnType<typeof runWithTimeoutAndRetry<string>>>;

    type HasRoundLimit = "roundLimit" extends keyof RunnerOptions ? true : false;
    type HasMaxRounds = "maxRounds" extends keyof RunnerOptions ? true : false;
    type HasRounds = "rounds" extends keyof RunnerResult ? true : false;

    const hasRoundLimit: HasRoundLimit = false;
    const hasMaxRounds: HasMaxRounds = false;
    const hasRounds: HasRounds = false;

    expect(hasRoundLimit).toBe(false);
    expect(hasMaxRounds).toBe(false);
    expect(hasRounds).toBe(false);
  });
});
