import { describe, expect, it, vi } from "vitest";
import { createAmapThrottle } from "@/lib/amap/throttle";

describe("createAmapThrottle", () => {
  it("starts at most three jobs in the first second and the rest in the next second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    try {
      const throttle = createAmapThrottle({ requestsPerSecond: 3 });
      const startedAt: number[] = [];

      const jobs = Array.from({ length: 5 }, () =>
        throttle.schedule(async () => {
          startedAt.push(Date.now());
          return startedAt.length;
        })
      );

      await vi.advanceTimersByTimeAsync(0);

      expect(startedAt).toEqual([0, 0, 0]);

      await vi.advanceTimersByTimeAsync(999);
      expect(startedAt).toEqual([0, 0, 0]);

      await vi.advanceTimersByTimeAsync(1);
      expect(startedAt).toEqual([0, 0, 0, 1000, 1000]);

      await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3, 4, 5]);
    } finally {
      vi.useRealTimers();
    }
  });
});
