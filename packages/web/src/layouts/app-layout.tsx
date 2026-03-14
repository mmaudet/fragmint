import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { BookOpen, BarChart3, FileText, CheckCircle, Upload, LogOut, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();

  const navItems = [
    { to: '/fragments', label: t('nav', 'library'), icon: BookOpen },
    { to: '/inventory', label: t('nav', 'inventory'), icon: BarChart3 },
    { to: '/compose', label: t('nav', 'composer'), icon: FileText },
    { to: '/harvest', label: t('nav', 'harvest'), icon: Upload },
    { to: '/validation', label: t('nav', 'validation'), icon: CheckCircle },
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-slate-300 flex flex-col">
        <div className="p-4 pb-3">
          <h1 className="text-lg font-bold text-white">⬡ Fragmint</h1>
        </div>
        <Separator className="bg-slate-700" />
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-primary/20 text-white font-medium'
                  : 'hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <Separator className="bg-slate-700" />
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="flex gap-1">
              <Button variant={lang === 'fr' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLang('fr')} className="h-7 px-2 text-xs">FR</Button>
              <Button variant={lang === 'en' ? 'secondary' : 'ghost'} size="sm" onClick={() => setLang('en')} className="h-7 px-2 text-xs">EN</Button>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-slate-300 hover:text-white hover:bg-slate-800">
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
