export type AgentRunContext = {
  attempt: number;
  signal: AbortSignal;
};

export type RunWithTimeoutAndRetryOptions<T> = {
  timeoutMs: number;
  maxAttempts: number;
  run(context: AgentRunContext): Promise<T>;
};

export type RunWithTimeoutAndRetryResult<T> = {
  value: T;
  attempts: number;
  timedOutAttempts: number;
};

export class AgentRunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent planning attempt timed out after ${timeoutMs}ms.`);
    this.name = "AgentRunTimeoutError";
  }
}

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

function isRunnerTimeoutAbort(error: unknown, signal: AbortSignal) {
  return (
    isAbortError(error) &&
    signal.aborted &&
    signal.reason instanceof AgentRunTimeoutError
  );
}

async function runAttempt<T>(
  options: RunWithTimeoutAndRetryOptions<T>,
  attempt: number
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutError = new AgentRunTimeoutError(options.timeoutMs);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, options.timeoutMs);
    });

    return {
      value: await Promise.race([
        options.run({ attempt, signal: controller.signal }),
        timeoutPromise,
      ]),
      timedOut: false,
    };
  } catch (error) {
    if (
      error instanceof AgentRunTimeoutError ||
      isRunnerTimeoutAbort(error, controller.signal)
    ) {
      throw new AgentRunTimeoutError(options.timeoutMs);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runWithTimeoutAndRetry<T>(
  options: RunWithTimeoutAndRetryOptions<T>
): Promise<RunWithTimeoutAndRetryResult<T>> {
  if (options.timeoutMs <= 0) {
    throw new Error("timeoutMs must be greater than zero.");
  }

  if (options.maxAttempts <= 0) {
    throw new Error("maxAttempts must be greater than zero.");
  }

  let timedOutAttempts = 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const result = await runAttempt(options, attempt);
      return {
        value: result.value,
        attempts: attempt,
        timedOutAttempts,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof AgentRunTimeoutError) {
        timedOutAttempts += 1;
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Agent planning failed after all attempts.");
}
