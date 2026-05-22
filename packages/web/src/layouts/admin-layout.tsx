import { NavLink, Outlet, Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import {
  Tag,
  GitBranch,
  ArrowLeftRight,
  AlertTriangle,
  Users,
  Layers,
  ArrowLeft,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };

const adminNavItems = [
  { to: '/admin/metadata', label: 'Metadata', icon: Tag },
  { to: '/admin/relations', label: 'Relations', icon: GitBranch },
  { to: '/admin/supersedure', label: 'Supersedure', icon: ArrowLeftRight },
  { to: '/admin/contradictions', label: 'Contradictions', icon: AlertTriangle },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/collections', label: 'Collections', icon: Layers },
];

export default function AdminLayout() {
  const { user } = useAuth();
  if ((ROLE_LEVEL[user?.role ?? 'reader'] ?? 0) < ROLE_LEVEL['admin']) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-red-950 text-red-100 flex flex-col shrink-0">
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
              {label}
            </NavLink>
          ))}
        </nav>

        <Separator className="bg-red-800" />

        <div className="p-3">
          <Link
            to="/home"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-red-300 hover:text-white hover:bg-red-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Fragmint
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
