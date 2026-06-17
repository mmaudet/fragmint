import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

interface FragmentsData {
  items: unknown[];
  pagination: { total: number };
  stats: { by_status: { draft: number; reviewed: number; approved: number; deprecated: number } };
}

/** Returns the number of fragments awaiting approval (draft + reviewed). */
export function useFragmentPendingCount(): number {
  const { data } = useQuery<FragmentsData>({
    queryKey: ['admin', 'fragments', 'pending-count'],
    queryFn: () => apiRequest('GET', '/v1/admin/fragments?limit=1'),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 5,
  });
  if (!data?.stats) return 0;
  return (data.stats.by_status.draft ?? 0) + (data.stats.by_status.reviewed ?? 0);
}
