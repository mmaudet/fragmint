// In-memory store for async search-all-sections jobs (MCP use only).
// Resets on server restart — acceptable since MCP polls until done within the same session.

export type SearchJobStatus = 'running' | 'done' | 'error';

interface SearchJob {
  status: SearchJobStatus;
  planId: string;
  error?: string;
}

const jobs = new Map<string, SearchJob>();

export function createSearchJob(planId: string): string {
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'running', planId });
  return jobId;
}

export function resolveSearchJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, status: 'done' });
}

export function failSearchJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, status: 'error', error });
}

export function getSearchJob(jobId: string): SearchJob | undefined {
  return jobs.get(jobId);
}

export function deleteSearchJob(jobId: string): void {
  jobs.delete(jobId);
}
