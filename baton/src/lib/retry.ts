/**
 * Small async retry helper for boot-time initialization.
 *
 * Used for infrastructure setup where a dependency (local emulator, AWS
 * endpoint) may answer a moment later than we ask — not for request-path
 * retries (SQS workers have their own redelivery semantics).
 */

export interface RetryOptions {
  attempts: number;
  delayMs: number;
  onRetry?: (err: unknown, attempt: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.attempts) {
        opts.onRetry?.(err, attempt);
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
  }
  throw lastError;
}
