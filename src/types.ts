export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dlq' | 'cancelled' | 'replayed';
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';
export type WebhookEvent = 'completed' | 'failed' | 'dlq';
/** F-12: policy applied when a job handler exceeds its declared timeoutMs. */
export type TimeoutPolicy = 'retry' | 'dlq' | 'escalate';

export interface BackoffConfig {
  strategy: BackoffStrategy;
  delayMs: number;
}

/** F-11: batch mode configuration for a job type. */
export interface BatchConfig {
  /** Maximum number of jobs to assemble into one batch before dispatching. */
  maxSize: number;
  /** Maximum ms to wait since the oldest job was enqueued before dispatching. */
  maxWaitMs: number;
}

export interface HandlerOptions {
  concurrency?: number;
  timeout?: number;
  maxRetries?: number;
  backoff?: BackoffStrategy | BackoffConfig;
  cron?: string;
  /** Maximum ms a pending job may wait before being promoted past higher-priority jobs. Default: 30000. */
  maxWaitMs?: number;
  /** F-11: opt-in batch mode for this job type. */
  batch?: BatchConfig;
  /** F-12: maximum wall-clock ms a handler may run. When exceeded Forge forcibly abandons
   *  the handler promise and applies timeoutPolicy. Defaults to the existing `timeout` field
   *  value when timeoutPolicy is set, but explicit declaration signals intent. */
  timeoutMs?: number;
  /** F-12: policy applied on timeout. */
  timeoutPolicy?: TimeoutPolicy;
}

export interface JobContext {
  id: string;
  type: string;
  payload: unknown;
  attempt: number;
}

/** F-11: context passed to a batch handler. */
export interface BatchJobContext {
  id: string;
  payload: unknown;
}

export type Handler = (ctx: JobContext) => Promise<void> | void;
/** F-11: batch handler receives an array of job contexts. */
export type BatchHandler = (jobs: BatchJobContext[]) => Promise<void> | void;

export interface RegisteredHandler {
  handler: Handler;
  concurrency: number;
  timeout: number;
  maxRetries: number;
  backoff: BackoffConfig;
  cron?: string;
  /** Maximum ms a pending job of this type may wait before starvation promotion. Default: 30000. */
  maxWaitMs: number;
  /** F-11: batch mode config; undefined means scalar (non-batch) dispatch. */
  batch?: BatchConfig;
  /** F-11: batch handler; defined iff batch is defined. */
  batchHandler?: BatchHandler;
  /** F-12: explicit timeout enforcement in ms. When set, combined with timeoutPolicy. */
  timeoutMs?: number;
  /** F-12: policy applied on timeout. Undefined means no special timeout handling. */
  timeoutPolicy?: TimeoutPolicy;
}

export interface JobRow {
  id: string;
  type: string;
  queue: string;
  payload: string;
  status: JobStatus;
  priority: number;
  eligible_at: number;
  enqueued_at: number;
  started_at: number | null;
  completed_at: number | null;
  attempt: number;
  result: string | null;
  error: string | null;
  webhook_url: string | null;
  webhook_events: string | null;
  /** F-13: ID of the new job created when this DLQ job was replayed. Null until replayed. */
  replayed_as: string | null;
  /** F-12: timestamp of the most recent timeout event (ms since epoch), or null. */
  timed_out_at: number | null;
  /** F-12: number of consecutive timeouts without a successful run in between. */
  consecutive_timeout_count: number;
}

export interface AttemptRow {
  id: number;
  job_id: string;
  attempt: number;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  error: string | null;
}

export interface WebhookDeliveryRow {
  id: number;
  job_id: string;
  event: string;
  attempted_at: number;
  status_code: number | null;
  response_time_ms: number | null;
  outcome: string;
  error: string | null;
}

export interface ScheduledJobRow {
  type: string;
  cron: string;
  last_run_at: number | null;
  next_run_at: number;
  last_20_results: string;
}

export interface ScheduledResult {
  timestamp: number;
  duration_ms: number;
  success: boolean;
  error: string | null;
}

export interface WebhookQueueRow {
  id: number;
  job_id: string;
  url: string;
  event: string;
  body: string;
  status: string;
  attempt: number;
  eligible_at: number;
  created_at: number;
  last_error: string | null;
}

export interface AuditLogRow {
  id: number;
  event: string;
  job_id: string | null;
  created_at: number;
  data: string;
}
