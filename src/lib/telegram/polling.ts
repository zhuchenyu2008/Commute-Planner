import { createTelegramBotClient, type TelegramBotClient } from "./client";
import { handleTelegramUpdate } from "./handler";
import {
  getNextTelegramOffset,
  markTelegramUpdateProcessed,
} from "./state";
import type { TelegramUpdate } from "./types";

export type ProcessTelegramPollingBatchInput = {
  bot: TelegramBotClient;
  offset?: number;
  timeoutSeconds: number;
  signal?: AbortSignal;
  handleUpdate(update: TelegramUpdate): Promise<void>;
  markProcessed(updateId: number): Promise<unknown>;
};

export async function processTelegramPollingBatch(
  input: ProcessTelegramPollingBatchInput
): Promise<number> {
  const updates = await input.bot.getUpdates({
    offset: input.offset,
    timeoutSeconds: input.timeoutSeconds,
    signal: input.signal,
  });

  for (const update of updates) {
    await input.handleUpdate(update);
    await input.markProcessed(update.update_id);
  }

  return updates.length;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let settled = false;

    const handleAbort = () => {
      finish();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", handleAbort);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    timeout = setTimeout(finish, ms);
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) finish();
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export async function runTelegramPolling(input: {
  token: string;
  timeoutSeconds?: number;
  idleDelayMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const bot = createTelegramBotClient({ token: input.token });
  const timeoutSeconds = input.timeoutSeconds ?? 30;
  const idleDelayMs = input.idleDelayMs ?? 1000;

  while (!input.signal?.aborted) {
    const offset = await getNextTelegramOffset();

    try {
      await processTelegramPollingBatch({
        bot,
        offset,
        timeoutSeconds,
        signal: input.signal,
        handleUpdate: (update) => handleTelegramUpdate({ update, bot }),
        markProcessed: markTelegramUpdateProcessed,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      console.error("Telegram polling failed; retrying.", error);
    }

    await sleep(idleDelayMs, input.signal);
  }
}
