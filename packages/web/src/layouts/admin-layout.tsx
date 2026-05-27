import { NavLink, Outlet, Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import {
  Tag,
  ArrowLeftRight,
  Users,
  Layers,
  ArrowLeft,
  Shield,
  LogOut,
  ChevronDown,
  HelpCircle,
  FileStack,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { useSupersedureStats } from '@/api/hooks/use-supersedure-proposals';
import { useMetadataPendingCount } from '@/api/hooks/use-metadata-proposals';
import { useInactiveUsersCount } from '@/api/hooks/use-users';
import { useFragmentPendingCount } from '@/api/hooks/use-fragment-pending-count';

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };

const adminNavItems = [
  { to: '/admin/fragments', label: 'Fragments', icon: FileStack },
  { to: '/admin/metadata', label: 'Metadata', icon: Tag },
  { to: '/admin/supersedure', label: 'Remplacements', icon: ArrowLeftRight },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/collections', label: 'Collections', icon: Layers },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { data: supersedureStats } = useSupersedureStats();
  const { data: metadataPending } = useMetadataPendingCount();
  const inactiveUsers = useInactiveUsersCount();
  const fragmentPending = useFragmentPendingCount();
  if ((ROLE_LEVEL[user?.role ?? 'reader'] ?? 0) < ROLE_LEVEL['admin']) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-red-950 text-red-100 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 pb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-red-400" />
          <span className="text-lg font-bold text-white tracking-tight">
            Admin <span className="text-red-400">Fragmint</span>
          </span>
        </div>

        <Separator className="bg-red-800" />

        <nav className="flex-1 p-2 space-y-1 mt-1">
          {adminNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-red-800 text-white font-medium'
                    : 'text-red-200 hover:bg-red-900 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {to === '/admin/fragments' && fragmentPending > 0 && (
                <span className="ml-auto bg-red-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                  {fragmentPending}
                </span>
              )}
              {to === '/admin/supersedure' &&
                supersedureStats &&
                supersedureStats.pending > 0 && (
                  <span className="ml-auto bg-red-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                    {supersedureStats.pending}
                  </span>
                )}
              {to === '/admin/metadata' &&
                metadataPending &&
                metadataPending.total > 0 && (
                  <span className="ml-auto bg-red-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                    {metadataPending.total}
                  </span>
                )}
              {to === '/admin/users' && inactiveUsers > 0 && (
                <span className="ml-auto bg-red-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                  {inactiveUsers}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <Separator className="bg-red-800" />

        <div className="p-3 space-y-2">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-red-800 text-white font-medium'
                  : 'text-red-300 hover:text-white hover:bg-red-900',
              )
            }
          >
            <HelpCircle className="h-4 w-4" />
            Guide
          </NavLink>
          <NavLink
            to="/admin/retrieval"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-red-800 text-white font-medium'
                  : 'text-red-300 hover:text-white hover:bg-red-900',
              )
            }
          >
            <SlidersHorizontal className="h-4 w-4" />
            Retrieval
          </NavLink>
          <Link
            to="/home"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-red-300 hover:text-white hover:bg-red-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Fragmint
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="flex gap-1">
              <Button
                variant={lang === 'fr' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setLang('fr')}
                className="h-7 px-2 text-xs"
              >
                FR
              </Button>
              <Button
                variant={lang === 'en' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setLang('en')}
                className="h-7 px-2 text-xs"
              >
                EN
              </Button>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between text-red-200 hover:text-white hover:bg-red-900"
              >
                <span className="text-sm truncate">{user?.display_name || user?.login}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                {t('nav', 'logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
