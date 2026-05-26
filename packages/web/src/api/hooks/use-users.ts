import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { AdminUser } from '@/api/types';

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiRequest<AdminUser[]>('GET', '/v1/users'),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 5,
  });
}

/** Count of inactive (active=0) users — used for the admin sidebar badge. */
export function useInactiveUsersCount() {
  const { data: users = [] } = useUsers();
  return users.filter((u) => u.active === 0).length;
}

export interface CreateUserInput {
  login: string;
  password: string;
  display_name: string;
  role: string;
  /** 1 = active immediately (default), 0 = pending activation */
  active?: number;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiRequest<AdminUser>('POST', '/v1/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export interface UpdateUserInput {
  role?: string;
  display_name?: string;
  active?: number;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      apiRequest<AdminUser>('PATCH', `/v1/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ deleted: boolean }>('DELETE', `/v1/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}
