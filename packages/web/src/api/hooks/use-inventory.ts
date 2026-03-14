import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { InventoryResult } from '@/api/types';

export function useInventory(topic?: string) {
  return useQuery({
    queryKey: ['inventory', topic],
    queryFn: () => apiRequest<InventoryResult>('POST', '/v1/fragments/inventory', topic ? { topic } : {}),
  });
}
