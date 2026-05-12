import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getToken } from '@/api/client';
import type { Plan, PlanFilters, PlanSection, PlanStatus } from '@/api/types';

const KEY = ['plans'] as const;

export function usePlans() {
  return useQuery<Plan[]>({
    queryKey: KEY,
    queryFn: () => apiRequest<Plan[]>('GET', '/v1/plans'),
  });
}

export function usePlan(id: string | null) {
  return useQuery<Plan>({
    queryKey: [...KEY, id],
    enabled: !!id,
    queryFn: () => apiRequest<Plan>('GET', `/v1/plans/${id}`),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; spec_prompt: string; filters?: PlanFilters }) =>
      apiRequest<Plan>('POST', '/v1/plans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      patch: Partial<{
        title: string;
        status: PlanStatus;
        spec_prompt: string;
        filters: PlanFilters;
        plan_markdown: string;
        draft_markdown: string;
        draft_dirty: boolean;
        writer_prompt_override: string;
        sections: PlanSection[];
        export_style_template_id: string | null;
      }>,
    ) => apiRequest<Plan>('PATCH', `/v1/plans/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...KEY, id] });
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('DELETE', `/v1/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useGeneratePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { extra_instructions?: string }) =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/generate-plan`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useValidatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/validate-plan`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useSectionSearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sectionId: string; filters_override?: PlanFilters }) =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/sections/${args.sectionId}/search`, {
        filters_override: args.filters_override,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useValidateFragments(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/validate-fragments`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useGenerateSection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: string) =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/sections/${sectionId}/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

export function useAssemble(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/assemble`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
  });
}

// Export returns a blob directly (markdown text or docx binary). Caller handles download.
export async function exportPlan(
  id: string,
  format: 'md' | 'docx',
  style_template_id?: string,
): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/v1/plans/${id}/export`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ format, style_template_id }),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return await res.blob();
}
