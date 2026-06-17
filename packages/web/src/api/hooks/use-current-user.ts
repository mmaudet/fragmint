import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export interface CurrentUser {
  id: string;
  login: string;
  role: string;
  display_name: string;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiRequest<CurrentUser>('GET', '/v1/me'),
    staleTime: 5 * 60 * 1000,
  });
}

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
const hasRole = (role: string, min: string) => (ROLE_LEVEL[role] ?? -1) >= (ROLE_LEVEL[min] ?? 999);

export function canEditFragment(
  user: CurrentUser | undefined,
  fragmentAuthor: string | undefined,
): boolean {
  if (!user) return false;
  if (hasRole(user.role, 'expert')) return true;
  return user.login === fragmentAuthor;
}

export function canReview(user: CurrentUser | undefined): boolean {
  return !!user && hasRole(user.role, 'contributor');
}

export function canApprove(user: CurrentUser | undefined): boolean {
  return !!user && hasRole(user.role, 'expert');
}

export function canDelete(user: CurrentUser | undefined): boolean {
  return !!user && hasRole(user.role, 'admin');
}
