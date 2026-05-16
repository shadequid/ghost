/**
 * AsyncKeyLock — promise-chaining per-key serialization.
 *
 * Queues async work so that at most one function runs per key at a time.
 * Failed tasks do not poison subsequent waiters on the same key.
 */

export class AsyncKeyLock {
  private readonly locks = new Map<string, Promise<void>>();

  /** Run `fn` after all previously queued work for `key` has settled. */
  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();

    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const current = prev.then(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
        throw err;
      }
    });

    // Store the settled (error-swallowed) version so a failed task
    // does not block subsequent waiters.
    const settled = current.catch(() => {});
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });

    return result;
  }
}
