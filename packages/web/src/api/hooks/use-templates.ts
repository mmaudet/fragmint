import { useQuery } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';
import type { Template } from '@/api/types';

export function useTemplates(collectionSlug: string) {
  return useQuery({
    queryKey: ['templates', collectionSlug],
    queryFn: () => apiRequest<Template[]>('GET', collectionApiUrl(collectionSlug, '/templates')),
  });
}

export function useTemplate(collectionSlug: string, id: string | null) {
  return useQuery({
    queryKey: ['template', collectionSlug, id],
    queryFn: () => apiRequest<Template>('GET', collectionApiUrl(collectionSlug, `/templates/${id}`)),
    enabled: !!id,
  });
}
