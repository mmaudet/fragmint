import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, collectionApiUrl, getToken } from '@/api/client';
import type { Plan, PlanFilters, PlanSection, PlanStatus, FragmentCollection } from '@/api/types';

export function usePlans() {
  return useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: () => apiRequest<Plan[]>('GET', '/v1/plans'),
  });
}

export function usePlan(id: string | null, opts?: { refetchInterval?: number | false }) {
  return useQuery<Plan>({
    queryKey: ['plans', id],
    enabled: !!id,
    queryFn: () => apiRequest<Plan>('GET', `/v1/plans/${id}`),
    refetchInterval: opts?.refetchInterval,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; spec_prompt: string; filters?: PlanFilters }) =>
      apiRequest<Plan>('POST', '/v1/plans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
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
    onSuccess: (_data, patch) => {
      qc.invalidateQueries({ queryKey: ['plans', id] });
      if (patch.title !== undefined) {
        qc.invalidateQueries({ queryKey: ['plans'] });
      }
    },
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>('DELETE', `/v1/plans/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['plans'] });
      const previous = qc.getQueryData<Plan[]>(['plans']);
      qc.setQueryData<Plan[]>(['plans'], (old) => (old ?? []).filter((p) => p.id !== id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(['plans'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function useDeletePlans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiRequest<void>('DELETE', `/v1/plans/${id}`)));
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['plans'] });
      const previous = qc.getQueryData<Plan[]>(['plans']);
      const idSet = new Set(ids);
      qc.setQueryData<Plan[]>(['plans'], (old) => (old ?? []).filter((p) => !idSet.has(p.id)));
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(['plans'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function useGeneratePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/generate-plan`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useValidatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/validate-plan`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useSectionSearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sectionId: string; filters_override?: PlanFilters }) =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/sections/${args.sectionId}/search`, {
        filters_override: args.filters_override,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useSearchAllSections(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/search-all-sections`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useValidateFragments(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/validate-fragments`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export interface AddFragmentArgs {
  sectionId: string;
  fragment_id?: string;
  manual?: { body: string; type?: string; lang?: string; domain?: string; propose_to_library?: boolean };
}

export function useAddFragmentToSection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sectionId, fragment_id, manual }: AddFragmentArgs) =>
      apiRequest<Plan>(
        'POST',
        `/v1/plans/${id}/sections/${sectionId}/add-fragment`,
        fragment_id ? { fragment_id } : { manual },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useGenerateSection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: string) =>
      apiRequest<Plan>('POST', `/v1/plans/${id}/sections/${sectionId}/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

export function useFragmentCollections() {
  return useQuery<FragmentCollection[]>({
    queryKey: ['fragment-collections'],
    queryFn: () => apiRequest<FragmentCollection[]>('GET', '/v1/fragment-collections'),
  });
}

export function useFragmentCollection(id: string | null) {
  return useQuery<FragmentCollection>({
    queryKey: ['fragment-collection', id],
    enabled: !!id,
    queryFn: () => apiRequest<FragmentCollection>('GET', `/v1/fragment-collections/${id}`),
  });
}

export function useFragmentCollectionsByFragmentId(fragmentId: string | null) {
  return useQuery<FragmentCollection[]>({
    queryKey: ['fragment-collections-by-fragment', fragmentId],
    enabled: !!fragmentId,
    queryFn: () =>
      apiRequest<FragmentCollection[]>('GET', `/v1/fragment-collections?fragment_id=${fragmentId}`),
  });
}

export function useAssemble(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<Plan>('POST', `/v1/plans/${id}/assemble`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });
}

// Export returns a blob directly (markdown text, docx binary, or presentation file). Caller handles download.
export async function exportPlan(
  id: string,
  format: 'md' | 'docx' | 'pptx' | 'slides' | 'reveal',
  opts?: {
    style_template_id?: string;
    marp_theme?: 'linagora' | 'default' | 'gaia' | 'uncover';
    reveal_theme?: 'linagora' | 'white' | 'black' | 'moon' | 'sky' | 'beige' | 'simple' | 'solarized';
  },
): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/v1/plans/${id}/export`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ format, ...opts }),
  });
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* non-JSON response */ }
    throw new Error(msg);
  }
  return await res.blob();
}
