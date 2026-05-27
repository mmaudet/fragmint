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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  SquareArrowOutUpRight,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRetrievalMode,
  useSetRetrievalMode,
  type RetrievalMode,
} from '@/api/hooks/use-retrieval-mode';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';

const RETRIEVAL_LABELS: Record<RetrievalMode, string> = {
  'vector-only': 'Vectoriel',
  'agentic-only': 'Agentique',
  hybrid: 'Hybride',
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { setCollections } = useCollection();
  const { data: cols } = useCollections();
  const { data: modeData } = useRetrievalMode();
  const setMode = useSetRetrievalMode();

  useEffect(() => {
    if (cols) setCollections(cols);
  }, [cols, setCollections]);

  const topNavItems = [{ to: '/home', label: t('nav', 'home'), icon: Home }];

  const role = user?.role ?? 'reader';
  const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
  const hasRole = (min: string) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 999);

  const navItems = [
    { to: '/fragments', label: t('nav', 'library'), icon: BookOpen },
    { to: '/harvest', label: t('nav', 'harvest'), icon: Upload },
    ...(hasRole('contributor')
      ? [{ to: '/validation', label: t('nav', 'validation'), icon: CheckCircle }]
      : []),
    { to: '/plan-generation', label: t('nav', 'planGeneration'), icon: PenLine },
  ];

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 text-slate-300 flex flex-col">
        <div className="p-4 pb-3">
          <NavLink
            to="/home"
            className="text-lg font-bold text-white hover:text-slate-200 transition-colors"
          >
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
              {hasRole('admin') && (
                <>
                  <DropdownMenuItem asChild>
                    <NavLink
                      to="/admin"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <Shield className="h-4 w-4 text-red-500" />
                      <span className="text-red-500">Administration</span>
                      <SquareArrowOutUpRight className="h-3 w-3 ml-auto opacity-50" />
                    </NavLink>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="flex items-center gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>Retrieval</span>
                      {modeData?.mode && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {RETRIEVAL_LABELS[modeData.mode]}
                        </span>
                      )}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={modeData?.mode ?? ''}
                        onValueChange={(v) => {
                          const mode = v as RetrievalMode;
                          setMode.mutate(mode, {
                            onSuccess: () => toast.success(`Mode ${RETRIEVAL_LABELS[mode]} activé`),
                            onError: () => toast.error('Erreur lors du changement de mode'),
                          });
                        }}
                      >
                        <DropdownMenuRadioItem value="vector-only">
                          Vectoriel
                          <span className="ml-1.5 text-xs text-muted-foreground">~100ms</span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="hybrid">
                          Hybride ⭐
                          <span className="ml-1.5 text-xs text-muted-foreground">1–3s</span>
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="agentic-only">
                          Agentique
                          <span className="ml-1.5 text-xs text-muted-foreground">2–5s</span>
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <Separator className="my-1" />
                </>
              )}
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
