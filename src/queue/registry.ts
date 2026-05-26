import type { BatchHandler, Handler, HandlerOptions, RegisteredHandler } from '../types.js';

const registry = new Map<string, RegisteredHandler>();

export function register(
  type: string,
  handler: Handler | BatchHandler,
  options?: HandlerOptions,
): void {
  const rawBackoff = options?.backoff;
  const backoff =
    typeof rawBackoff === 'object'
      ? { strategy: rawBackoff.strategy, delayMs: rawBackoff.delayMs ?? 1_000 }
      : { strategy: rawBackoff ?? 'exponential', delayMs: 1_000 };

  const isBatch = options?.batch !== undefined;

  registry.set(type, {
    handler: isBatch ? (() => {}) as Handler : (handler as Handler),
    concurrency: options?.concurrency ?? 1,
    timeout: options?.timeout ?? 30_000,
    maxRetries: options?.maxRetries ?? 3,
    backoff,
    cron: options?.cron,
    maxWaitMs: options?.maxWaitMs ?? 30_000,
    batch: options?.batch,
    batchHandler: isBatch ? (handler as BatchHandler) : undefined,
    timeoutMs: options?.timeoutMs,
    timeoutPolicy: options?.timeoutPolicy,
  });
}

export function getHandler(type: string): RegisteredHandler | undefined {
  return registry.get(type);
}

export function getAllRegistered(): Map<string, RegisteredHandler> {
  return registry;
}
