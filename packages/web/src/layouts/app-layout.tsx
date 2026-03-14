import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { BookOpen, BarChart3, FileText, CheckCircle, LogOut, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/fragments', label: 'Bibliothèque', icon: BookOpen },
  { to: '/inventory', label: 'Inventaire', icon: BarChart3 },
  { to: '/compose', label: 'Compositeur', icon: FileText },
  { to: '/validation', label: 'Validation', icon: CheckCircle },
];

export default function AppLayout() {
  const { user, logout } = useAuth();

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
        <div className="p-3">
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
                Déconnexion
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
