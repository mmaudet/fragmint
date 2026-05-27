import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

interface TaxonomyEntry {
  slug: string;
  label?: string | null;
}

interface TagEntry {
  slug: string;
  label: string | null;
  category: string | null;
  usage_count: number;
}

export function useDomains() {
  return useQuery({
    queryKey: ['fragment-domains'],
    queryFn: () => apiRequest<TaxonomyEntry[]>('GET', '/v1/fragment-domains'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTypes() {
  return useQuery({
    queryKey: ['fragment-types'],
    queryFn: () => apiRequest<TaxonomyEntry[]>('GET', '/v1/fragment-types'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['references-tags'],
    queryFn: () => apiRequest<TagEntry[]>('GET', '/v1/references/tags'),
    staleTime: 5 * 60 * 1000,
  });
}
