import { useQuery } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';
import type { Template } from '@/api/types';

export interface ResolvedSlot {
  key: string;
  fragment_id: string;
  score: number;
  quality: string;
  title: string | null;
  body_excerpt: string | null;
  skipped: boolean;
}

export function useTemplates(collectionSlug: string) {
  return useQuery({
    queryKey: ['templates', collectionSlug],
    queryFn: () => apiRequest<Template[]>('GET', collectionApiUrl(collectionSlug, '/templates')),
  });
}

export function useTemplate(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['template', collectionSlug, id],
    queryFn: () =>
      apiRequest<Template>('GET', collectionApiUrl(collectionSlug, `/templates/${id}`)),
    enabled: !!id,
  });
}

export function useResolveSlots(
  collectionSlug: string,
  templateId: string | null,
  context: Record<string, string>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['resolve-slots', collectionSlug, templateId, context],
    queryFn: () =>
      apiRequest<ResolvedSlot[]>(
        'POST',
        collectionApiUrl(collectionSlug, `/templates/${templateId}/resolve`),
        { context },
      ),
    enabled: enabled && !!templateId,
    staleTime: 30_000,
  });
}
