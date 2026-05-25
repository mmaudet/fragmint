import type { JobService } from './job-service.js';

// V1 stub — computeQualitySignals requires full fragment body (not available from DB excerpt).
// Iterates fragment IDs and ticks the job for progress tracking.
export async function runRecalculationJob(
  jobService: JobService,
  jobId: string,
  fragmentIds: string[],
): Promise<void> {
  let done = 0;
  try {
    for (const _id of fragmentIds) {
      done++;
      if (done % 10 === 0) {
        await jobService.progress(jobId, done);
      }
    }
    await jobService.complete(jobId, done, 0);
  } catch {
    await jobService.fail(jobId);
  }
}
