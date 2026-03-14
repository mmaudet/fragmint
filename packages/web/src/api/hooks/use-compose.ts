import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { ComposeResponse } from '@/api/types';

interface ComposeParams {
  templateId: string;
  context: Record<string, any>;
  overrides?: Record<string, string>;
  structured_data?: Record<string, any>;
}

export function useCompose() {
  return useMutation({
    mutationFn: ({ templateId, ...body }: ComposeParams) =>
      apiRequest<ComposeResponse>('POST', `/v1/templates/${templateId}/compose`, body),
  });
}
