import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { useCollections } from '@/api/hooks/use-collections';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  BookOpen,
  CheckCircle,
  Upload,
  LogOut,
  ChevronDown,
  PenLine,
  Home,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { setCollections } = useCollection();
  const { data: cols } = useCollections();

  useEffect(() => {
    if (cols) setCollections(cols);
  }, [cols, setCollections]);

  const topNavItems = [
    { to: '/home', label: t('nav', 'home'), icon: Home },
  ];

  const role = user?.role ?? 'reader';
  const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
  const hasRole = (min: string) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 999);

  const navItems = [
    { to: '/fragments', label: t('nav', 'library'), icon: BookOpen },
    { to: '/harvest', label: t('nav', 'harvest'), icon: Upload },
    ...(hasRole('contributor') ? [{ to: '/validation', label: t('nav', 'validation'), icon: CheckCircle }] : []),
    { to: '/plan-generation', label: t('nav', 'planGeneration'), icon: PenLine },
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-slate-300 flex flex-col">
        <div className="p-4 pb-3">
          <NavLink to="/home" className="text-lg font-bold text-white hover:text-slate-200 transition-colors">
            ⬡ Fragmint
          </NavLink>
        </div>
        <Separator className="bg-slate-700" />

        {/* Global nav — above collection scope */}
        <nav className="p-2 pb-0 space-y-1">
          {topNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary/20 text-white font-medium'
                    : 'hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <Separator className="bg-slate-700 mt-2" />

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary/20 text-white font-medium'
                    : 'hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <Separator className="bg-slate-700" />
        <div className="p-3 space-y-2">
          {hasRole('admin') && (
            <NavLink
              to="/admin"
              target="_blank"
              rel="noopener noreferrer"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border w-full',
                  isActive
                    ? 'bg-red-900/60 text-red-200 border-red-700'
                    : 'text-red-400 border-red-900/50 hover:bg-red-900/40 hover:text-red-200',
                )
              }
            >
              <Shield className="h-3.5 w-3.5" />
              Admin
            </NavLink>
          )}
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
                className="w-full justify-between text-slate-300 hover:text-white hover:bg-slate-800"
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

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
