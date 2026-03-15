import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';
import type { Fragment, GitLogEntry } from '@/api/types';

interface FragmentFilters {
  type?: string;
  domain?: string;
  lang?: string;
  quality?: string;
  limit?: number;
  offset?: number;
}

export function useFragments(collectionSlug: string, filters: FragmentFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return useQuery({
    queryKey: ['fragments', collectionSlug, filters],
    queryFn: () => apiRequest<Fragment[]>('GET', collectionApiUrl(collectionSlug, `/fragments?${params}`)),
  });
}

export function useFragment(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['fragment', collectionSlug, id],
    queryFn: () => apiRequest<Fragment>('GET', collectionApiUrl(collectionSlug, `/fragments/${id}`)),
    enabled: !!id,
  });
}

export function useFragmentHistory(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['fragment-history', collectionSlug, id],
    queryFn: () => apiRequest<GitLogEntry[]>('GET', collectionApiUrl(collectionSlug, `/fragments/${id}/history`)),
    enabled: !!id,
  });
}

export function useSearchFragments(collectionSlug: string, query: string, filters?: Record<string, any>) {
  return useQuery({
    queryKey: ['fragment-search', collectionSlug, query, filters],
    queryFn: () => apiRequest<Fragment[]>('POST', collectionApiUrl(collectionSlug, '/fragments/search'), { query, filters }),
    enabled: query.length > 0,
  });
}

export function useReviewFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', collectionApiUrl(collectionSlug, `/fragments/${id}/review`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export function useApproveFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', collectionApiUrl(collectionSlug, `/fragments/${id}/approve`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}
