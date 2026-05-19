import { useQuery } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';

interface Facets {
  domains: string[];
  tags: string[];
}

export function useFacets(collectionSlug: string) {
  return useQuery<Facets>({
    queryKey: ['facets', collectionSlug],
    queryFn: () => apiRequest<Facets>('GET', collectionApiUrl(collectionSlug, '/fragments/facets')),
    staleTime: 60_000,
  });
}
