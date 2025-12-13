import { WorkerPool } from "./worker_pool.js";

export class SubagentRuntime {
  constructor({ workerPool, defaultDeadlineMs = 30_000 } = {}) {
    this.workerPool = workerPool ?? new WorkerPool();
    this.defaultDeadlineMs = defaultDeadlineMs;
  }

  async run(task, { signal } = {}) {
    const deadlineMs = task.deadlineMs ?? this.defaultDeadlineMs;
    const startedAt = Date.now();

    const controller = new AbortController();
    const combinedSignal = anySignal([signal, controller.signal]);

    const timeoutError = new Error("Timed out");
    timeoutError.name = "TimeoutError";

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, deadlineMs);
      timeoutId.unref?.();
    });

    try {
      const value = await this.workerPool.run(
        () => Promise.race([task.run({ signal: combinedSignal }), timeoutPromise]),
        { signal: combinedSignal },
      );

      return {
        status: "ok",
        value,
        timing: { startedAt, elapsedMs: Date.now() - startedAt },
      };
    } catch (error) {
      if (error?.name === "TimeoutError") {
        return {
          status: "timeout",
          error: serializeError(error),
          timing: { startedAt, elapsedMs: Date.now() - startedAt },
        };
      }

      if (combinedSignal.aborted || error?.name === "AbortError") {
        return {
          status: "canceled",
          error: serializeError(error),
          timing: { startedAt, elapsedMs: Date.now() - startedAt },
        };
      }

      return {
        status: "error",
        error: serializeError(error),
        timing: { startedAt, elapsedMs: Date.now() - startedAt },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function anySignal(signals) {
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}

function serializeError(error) {
  if (!error) return { name: "Error", message: "Unknown error" };
  return {
    name: error.name ?? "Error",
    message: error.message ?? String(error),
  };
}
