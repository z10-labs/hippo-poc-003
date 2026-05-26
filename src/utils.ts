import type { BackoffStrategy } from './types.js';

/** F-12: sentinel error class so executeJob can distinguish a timeout from a
 *  handler rejection without relying on message-string matching. */
export class TimeoutError extends Error {
  readonly durationMs: number;
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.durationMs = ms;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function calcBackoffMs(strategy: BackoffStrategy, delayMs: number, attempt: number): number {
  switch (strategy) {
    case 'fixed':
      return delayMs;
    case 'linear':
      return delayMs * attempt;
    case 'exponential':
      return delayMs * Math.pow(2, attempt - 1);
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
