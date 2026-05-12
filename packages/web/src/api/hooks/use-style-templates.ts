import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getToken } from '@/api/client';
import type { StyleTemplate } from '@/api/types';

const KEY = ['style-templates'] as const;

export function useStyleTemplates() {
  return useQuery<StyleTemplate[]>({
    queryKey: KEY,
    queryFn: () => apiRequest<StyleTemplate[]>('GET', '/v1/templates?kind=style_reference'),
  });
}

export function useUploadStyleTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name: string; description?: string }) => {
      const form = new FormData();
      form.append('file', input.file);
      form.append('name', input.name);
      if (input.description) form.append('description', input.description);
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/v1/templates/style-reference', {
        method: 'POST',
        headers,
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const json = await res.json();
      return json.data as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
