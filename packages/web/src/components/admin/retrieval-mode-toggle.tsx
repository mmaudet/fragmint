import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import {
  useRetrievalMode,
  useSetRetrievalMode,
  type RetrievalMode,
} from '@/api/hooks/use-retrieval-mode';

const MODES: {
  value: RetrievalMode;
  label: string;
  tooltip: string;
}[] = [
  {
    value: 'vector-only',
    label: 'Vectoriel',
    tooltip: 'Milvus cosine similarity — <100ms, baseline',
  },
  {
    value: 'agentic-only',
    label: 'Agentique',
    tooltip: 'LLM judge sur index.md Karpathy — 2-5s/section, qualité maximale',
  },
  {
    value: 'hybrid',
    label: 'Hybride',
    tooltip: 'Milvus pré-filtrage + LLM re-rank — 1-3s, recommandé pour la démo',
  },
];

export function RetrievalModeToggle() {
  const { data } = useRetrievalMode();
  const setMode = useSetRetrievalMode();
  const current = data?.mode ?? null;

  const handleSelect = (mode: RetrievalMode) => {
    if (mode === current || setMode.isPending) return;
    setMode.mutate(mode, {
      onSuccess: () => {
        const label = MODES.find((m) => m.value === mode)?.label ?? mode;
        toast.success(`Mode ${label} activé`);
      },
      onError: () => toast.error('Erreur lors du changement de mode'),
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-red-400 font-medium px-1">Retrieval</span>
      <div className="flex rounded-md border border-red-800 overflow-hidden">
        {MODES.map((m, i) => {
          const isActive = current === m.value;
          return (
            <Tooltip key={m.value}>
              <button
                type="button"
                onClick={() => handleSelect(m.value)}
                disabled={setMode.isPending}
                className={cn(
                  'flex-1 px-2 py-1 text-xs font-medium transition-colors',
                  i > 0 && 'border-l border-red-800',
                  isActive
                    ? 'bg-red-600 text-white'
                    : 'text-red-300 hover:bg-red-900 hover:text-white',
                  setMode.isPending && 'opacity-50 cursor-not-allowed',
                )}
              >
                {m.label}
                {m.value === 'hybrid' && !isActive && <span className="ml-0.5 opacity-60">⭐</span>}
              </button>
              <TooltipContent side="right" className="max-w-[200px] text-xs">
                {m.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
