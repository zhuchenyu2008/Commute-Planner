export type AmapThrottleOptions = {
  requestsPerSecond: number;
};

export type AmapThrottle = {
  schedule<T>(job: () => Promise<T>): Promise<T>;
};

type QueuedJob = {
  job: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export function createAmapThrottle(options: AmapThrottleOptions): AmapThrottle {
  const requestsPerSecond = Math.max(1, Math.floor(options.requestsPerSecond));
  const queue: QueuedJob[] = [];
  let available = requestsPerSecond;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const ensureResetTimer = () => {
    resetTimer ??= setTimeout(() => {
      available = requestsPerSecond;
      resetTimer = undefined;
      drain();
    }, 1000);
  };

  const run = ({ job, resolve, reject }: QueuedJob) => {
    available -= 1;
    ensureResetTimer();

    Promise.resolve()
      .then(job)
      .then(resolve, reject);
  };

  const drain = () => {
    while (available > 0 && queue.length > 0) {
      const nextJob = queue.shift();
      if (nextJob) {
        run(nextJob);
      }
    }

    if (queue.length > 0) {
      ensureResetTimer();
    }
  };

  return {
    schedule<T>(job: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          job,
          resolve: (value) => resolve(value as T),
          reject
        });
        drain();
      });
    }
  };
}
