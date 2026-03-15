import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { CollectionWithRole } from '@/api/types';

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => apiRequest<CollectionWithRole[]>('GET', '/v1/collections'),
  });
}
