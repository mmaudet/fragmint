import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { CollectionWithRole } from '@/api/types';

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => apiRequest<CollectionWithRole[]>('GET', '/v1/collections'),
  });
}

export interface CreateCollectionInput {
  slug: string;
  name: string;
  type: 'system' | 'team' | 'personal';
  description?: string;
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string;
  read_only?: number;
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCollectionInput) =>
      apiRequest<CollectionWithRole>('POST', '/v1/collections', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: UpdateCollectionInput }) =>
      apiRequest<CollectionWithRole>('PUT', `/v1/collections/${slug}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      apiRequest<{ deleted: boolean }>('DELETE', `/v1/collections/${slug}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}
