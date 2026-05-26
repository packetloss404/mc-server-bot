/**
 * Race a promise against a deadline timer.
 *
 * On expiry the returned promise rejects with:
 *   `Error: <label> timed out after <ms>ms`
 *
 * The timer is always cleared when the underlying promise settles (resolve or
 * reject), so no timer leaks even if the caller discards the returned promise.
 *
 * @param promise - The promise to race.
 * @param ms      - Deadline in milliseconds.
 * @param label   - Human-readable label included in the timeout error message.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
