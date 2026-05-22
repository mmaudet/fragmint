import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, apiRequestFull, collectionApiUrl } from '@/api/client';
import type { Fragment, GitLogEntry } from '@/api/types';

interface FragmentFilters {
  type?: string;
  domain?: string;
  lang?: string;
  quality?: string;
  function_type?: string;
  audience?: string;
  maturity?: string;
  limit?: number;
  offset?: number;
}

export function useFragments(collectionSlug: string, filters: FragmentFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const query = useQuery({
    queryKey: ['fragments', collectionSlug, filters],
    queryFn: () =>
      apiRequestFull<Fragment[]>('GET', collectionApiUrl(collectionSlug, `/fragments?${params}`)),
  });
  return {
    ...query,
    data: query.data?.data,
    total: (query.data?.meta?.total as number | undefined),
  };
}

export function useFragment(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['fragment', collectionSlug, id],
    queryFn: () =>
      apiRequest<Fragment>('GET', collectionApiUrl(collectionSlug, `/fragments/${id}`)),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useFragmentHistory(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['fragment-history', collectionSlug, id],
    queryFn: () =>
      apiRequest<GitLogEntry[]>(
        'GET',
        collectionApiUrl(collectionSlug, `/fragments/${id}/history`),
      ),
    enabled: !!id,
  });
}

export function useSearchFragments(
  collectionSlug: string,
  query: string,
  filters?: Record<string, any>,
) {
  return useQuery({
    queryKey: ['fragment-search', collectionSlug, query, filters],
    queryFn: () =>
      apiRequest<Fragment[]>('POST', collectionApiUrl(collectionSlug, '/fragments/search'), {
        query,
        filters,
      }),
    enabled: query.length > 0,
  });
}

export function useReviewFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>('POST', collectionApiUrl(collectionSlug, `/fragments/${id}/review`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export function useApproveFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>('POST', collectionApiUrl(collectionSlug, `/fragments/${id}/approve`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export interface UpdateFragmentInput {
  body?: string;
  type?: string;
  domain?: string;
  lang?: string;
  tags?: string[];
  quality?: string;
}

export function useDeleteFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>('DELETE', collectionApiUrl(collectionSlug, `/fragments/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}

export function useUpdateFragment(collectionSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFragmentInput }) =>
      apiRequest<Fragment>('PUT', collectionApiUrl(collectionSlug, `/fragments/${id}`), input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fragments'] });
      qc.invalidateQueries({ queryKey: ['fragment'] });
    },
  });
}
