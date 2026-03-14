import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { Template } from '@/api/types';

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => apiRequest<Template[]>('GET', '/v1/templates'),
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ['template', id],
    queryFn: () => apiRequest<Template>('GET', `/v1/templates/${id}`),
    enabled: !!id,
  });
}
