export class WorkerPool {
  constructor({ maxConcurrent = 4 } = {}) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error("maxConcurrent must be a positive integer");
    }
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.queue = [];
  }

  run(fn, { signal } = {}) {
    if (typeof fn !== "function") throw new Error("WorkerPool.run requires a function");
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const job = { fn, resolve, reject, signal };
      this.queue.push(job);
      this.#drain();
    });
  }

  #drain() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job.signal?.aborted) {
        job.reject(abortError());
        continue;
      }

      this.active += 1;
      Promise.resolve()
        .then(() => job.fn())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.#drain();
        });
    }
  }
}

function abortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

