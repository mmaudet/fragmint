import { useMutation } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl } from '@/api/client';
import type { ComposeResponse } from '@/api/types';

interface ComposeParams {
  templateId: string;
  context: Record<string, any>;
  overrides?: Record<string, string>;
  structured_data?: Record<string, any>;
}

export function useCompose(collectionSlug: string) {
  return useMutation({
    mutationFn: ({ templateId, ...body }: ComposeParams) =>
      apiRequest<ComposeResponse>('POST', collectionApiUrl(collectionSlug, `/templates/${templateId}/compose`), body),
  });
}
