import { createContext, useContext, useState, type ReactNode } from 'react';
import { JobNotification } from '@/components/admin/job-notification';

interface ActiveJob {
  id: string;
  label: string;
}

interface ActiveJobsContextValue {
  addJob: (job: ActiveJob) => void;
  removeJob: (id: string) => void;
}

const ActiveJobsContext = createContext<ActiveJobsContextValue | null>(null);

export function ActiveJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);

  const addJob = (job: ActiveJob) => setJobs((prev) => [...prev, job]);
  const removeJob = (id: string) => setJobs((prev) => prev.filter((j) => j.id !== id));

  return (
    <ActiveJobsContext.Provider value={{ addJob, removeJob }}>
      {children}
      {jobs.map((job) => (
        <JobNotification
          key={job.id}
          jobId={job.id}
          label={job.label}
          onComplete={() => removeJob(job.id)}
        />
      ))}
    </ActiveJobsContext.Provider>
  );
}

export function useActiveJobs() {
  const ctx = useContext(ActiveJobsContext);
  if (!ctx) throw new Error('useActiveJobs must be used within ActiveJobsProvider');
  return ctx;
}
