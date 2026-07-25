/**
 * Pure instrumentation, no behavior change: a per-request, timestamped
 * step logger for diagnosing exactly where a request stops progressing.
 * Never catches or suppresses anything - callers still handle their own
 * errors exactly as before; this only logs.
 */
export type StepLogger = (label: string) => void;

let nextRequestId = 1;

export function createStepLogger(context: string): StepLogger {
  const requestId = `${context}-${nextRequestId++}`;
  const start = Date.now();
  let last = start;

  return function logStep(label: string): void {
    const now = Date.now();
    const sinceLast = now - last;
    const sinceStart = now - start;
    const iso = new Date(now).toISOString();
    const slowNote = sinceLast > 5000 ? ` *** SLOW STEP: ${sinceLast}ms ***` : "";

    console.log(`[${iso}] [${requestId}] ${label} (+${sinceLast}ms step, +${sinceStart}ms total)${slowNote}`);
    last = now;
  };
}

/** Logs the complete original error, including its stack trace - never
 *  a truncated/summarized version. */
export function logFullError(logStep: StepLogger, label: string, error: unknown): void {
  logStep(label);
  console.error(`[${label}] full original error:`, error);
}
