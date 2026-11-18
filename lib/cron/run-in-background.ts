import { after, NextResponse } from 'next/server';
import { logError } from '@/lib/actions/_shared/logger';
import { runWithRequestId } from '@/lib/observability/request-context';

/**
 * LAUNCH-L2: cron-job.org gives up after 30 seconds, but our jobs can run for minutes. So a cron route verifies the
 * secret, replies 202 straight away, and the job runs after the response (Next.js `after()`, supported by
 * `next start` on Render). Errors are logged (Sentry) and never thrown. Running a job twice is safe: the archival
 * sweep claims documents with a lease, and notifications are de-duplicated by a unique key.
 */
export function runCronInBackground(scope: string, requestId: string, job: () => Promise<unknown>): NextResponse {
  const task = (): Promise<void> =>
    runWithRequestId(requestId, async () => {
      try {
        await job();
      } catch (error: unknown) {
        logError(scope, error);
      }
    });

  try {
    after(task);
  } catch (error: unknown) {
    // `after` is unavailable outside a request scope (e.g. unit tests): run the job now, still without blocking.
    logError(`${scope}-schedule`, error, { fallback: 'inline' });
    void task();
  }

  return NextResponse.json({ status: 'accepted', job: scope }, { status: 202 });
}
