import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { Fragment, GitLogEntry } from '@/api/types';

interface FragmentFilters {
  type?: string;
  domain?: string;
  lang?: string;
  quality?: string;
  limit?: number;
  offset?: number;
}

export function useFragments(filters: FragmentFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return useQuery({
    queryKey: ['fragments', filters],
    queryFn: () => apiRequest<Fragment[]>('GET', `/v1/fragments?${params}`),
  });
}

export function useFragment(id: string | null) {
  return useQuery({
    queryKey: ['fragment', id],
    queryFn: () => apiRequest<Fragment>('GET', `/v1/fragments/${id}`),
    enabled: !!id,
  });
}

export function useFragmentHistory(id: string | null) {
  return useQuery({
    queryKey: ['fragment-history', id],
    queryFn: () => apiRequest<GitLogEntry[]>('GET', `/v1/fragments/${id}/history`),
    enabled: !!id,
  });
}

export function useSearchFragments(query: string, filters?: Record<string, any>) {
  return useQuery({
    queryKey: ['fragment-search', query, filters],
    queryFn: () => apiRequest<Fragment[]>('POST', '/v1/fragments/search', { query, filters }),
    enabled: query.length > 0,
  });
}

export function useReviewFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', `/v1/fragments/${id}/review`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export function useApproveFragment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('POST', `/v1/fragments/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}
