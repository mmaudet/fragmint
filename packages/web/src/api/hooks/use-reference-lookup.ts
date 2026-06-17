import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface ReferenceItem {
  slug: string;
  label: string;
  type?: string;
}

export function useReferenceLookup(kind: 'domain' | 'tag' | 'function', q: string) {
  return useQuery<ReferenceItem[]>({
    queryKey: ['reference-lookup', kind, q],
    queryFn: () => {
      const params = new URLSearchParams({ kind, q, limit: '15' });
      return apiRequest('GET', `/v1/admin/metadata/references/lookup?${params}`);
    },
    enabled: q.length > 0,
    staleTime: 30_000,
  });
}
