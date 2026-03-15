import { useQuery } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';
import type { InventoryResult } from '@/api/types';

export function useInventory(collectionSlug: string, topic?: string) {
  return useQuery({
    queryKey: ['inventory', collectionSlug, topic],
    queryFn: () => apiRequest<InventoryResult>('POST', collectionApiUrl(collectionSlug, '/fragments/inventory'), topic ? { topic } : {}),
  });
}
