import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

interface FragmentType {
  slug: string;
  label: string;
  description: string | null;
  created_at: string;
}

export function useFragmentTypes() {
  return useQuery({
    queryKey: ['fragment-types'],
    queryFn: () => apiRequest<FragmentType[]>('GET', '/v1/fragment-types'),
    staleTime: 5 * 60 * 1000,
  });
}
