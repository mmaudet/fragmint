import { useEffect, useRef, useState } from 'react';
import type { Plan, PlanSection } from '@/api/types';
import { useGenerateSection, useUpdatePlan, useAssemble } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Info, Copy, Check, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import type { GroundednessFlag } from '@/api/types';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const RISK_CONFIG = {
  high: { label: 'Risque élevé', icon: ShieldAlert, className: 'border-destructive/30 bg-destructive/5 text-destructive' },
  medium: { label: 'Risque moyen', icon: AlertTriangle, className: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400' },
  low: { label: 'Risque faible', icon: Info, className: 'border-yellow-400/30 bg-yellow-400/5 text-yellow-700 dark:text-yellow-400' },
} as const;

function GroundednessPanel({ flags }: { flags?: GroundednessFlag[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs font-medium text-muted-foreground">Vérification de fidélité ({flags.length} signal{flags.length > 1 ? 's' : ''})</p>
      {flags.map((f, i) => {
        const cfg = RISK_CONFIG[f.risk];
        const Icon = cfg.icon;
        return (
          <div key={i} className={`flex gap-2 rounded border px-3 py-2 text-xs ${cfg.className}`}>
            <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-medium">{cfg.label} — <span className="font-mono">"{f.text}"</span></p>
              <p className="opacity-80">{f.reason}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const HELP_DISMISS_KEY = 'fragmint.plan-step-help.dismissed.2';

function readDismissed() {
  try { return localStorage.getItem(HELP_DISMISS_KEY) === '1'; } catch { return false; }
}
function writeDismissed() {
  try { localStorage.setItem(HELP_DISMISS_KEY, '1'); } catch { /* ignore */ }
}

export function DraftsStep({ plan, onAssembled }: { plan: Plan; onAssembled?: () => void }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const [copiedSection, setCopiedSection] = useState(false);
  const [helpDismissed, setHelpDismissed] = useState(readDismissed);
  const [globalOverride, setGlobalOverride] = useState(plan.state.writer_prompt_override ?? '');

  function dismissHelp() { writeDismissed(); setHelpDismissed(true); }

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const update = useUpdatePlan(plan.id);
  const generate = useGenerateSection(plan.id);
  const assemble = useAssemble(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];
  const allGenerated = sections.length > 0 && sections.every((s) => !!s.generated_markdown);

  const [activeMarkdown, setActiveMarkdown] = useState(active?.generated_markdown ?? '');
  const [sectionInstructions, setSectionInstructions] = useState(active?.writer_instructions ?? '');
  const saveTimer = useRef<number | null>(null);
  const instrTimer = useRef<number | null>(null);

  useEffect(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setActiveMarkdown(active?.generated_markdown ?? '');
    setSectionInstructions(active?.writer_instructions ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.generated_markdown]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (instrTimer.current) window.clearTimeout(instrTimer.current);
    };
  }, []);

  async function generateOne(sectionId: string) {
    try {
      await generate.mutateAsync(sectionId);
    } catch (e: any) {
      toast.error(`Section generation failed: ${e.message ?? e}`);
    }
  }

  async function generateAll() {
    setProgress({ i: 0, total: sections.length });
    for (let i = 0; i < sections.length; i++) {
      try {
        await generate.mutateAsync(sections[i].id);
        setProgress({ i: i + 1, total: sections.length });
      } catch (e: any) {
        toast.error(`Failed on section "${sections[i].title}": ${e.message ?? e}`);
        break;
      }
    }
    setProgress(null);
  }

  function saveSectionMarkdown(s: PlanSection, md: string) {
    setActiveMarkdown(md);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const targetId = s.id;
    saveTimer.current = window.setTimeout(() => {
      update.mutate({
        sections: sections.map((x) => (x.id === targetId ? { ...x, generated_markdown: md } : x)),
      });
    }, 500);
  }

  function saveSectionInstructions(s: PlanSection, val: string) {
    setSectionInstructions(val);
    if (instrTimer.current) window.clearTimeout(instrTimer.current);
    const targetId = s.id;
    instrTimer.current = window.setTimeout(() => {
      update.mutate({
        sections: sections.map((x) => (x.id === targetId ? { ...x, writer_instructions: val } : x)),
      });
    }, 500);
  }

  return (
    <div className="flex flex-col">
      <div className="border-b p-3 space-y-2">
        <div className="flex items-center gap-3">
          <Button onClick={generateAll} disabled={progress !== null}>
            {progress && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {progress
              ? `${progress.i} / ${progress.total} ✓`
              : allGenerated
                ? t('planGeneration', 'regenerateAllSections')
                : t('planGeneration', 'generateAllSections')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              assemble.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t('planGeneration', 'assembleSuccess'));
                  onAssembled?.();
                },
                onError: (e: any) =>
                  toast.error(`${t('planGeneration', 'assembleError')} : ${e.message ?? e}`),
              })
            }
            disabled={assemble.isPending}
          >
            {assemble.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('planGeneration', 'assemble')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">
            {t('planGeneration', allGenerated ? 'regenerateAllSections' : 'generateAllSections')}
          </span>
          {' — '}
          {t('planGeneration', 'generateAllSectionsHint')}
          {' · '}
          <span className="font-medium">{t('planGeneration', 'assemble')}</span>
          {' — '}
          {t('planGeneration', 'assembleHint')}
        </p>
      </div>

      {!helpDismissed && (
        <div className="border-b bg-muted/40 px-4 py-3 space-y-3 shrink-0">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="flex-1 text-sm text-muted-foreground leading-relaxed">
              {t('planGeneration', 'step3Help')}
            </p>
            <button
              onClick={dismissHelp}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label={t('planGeneration', 'helpClose')}
              title={t('planGeneration', 'helpClose')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="pl-7 space-y-1">
            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {t('planGeneration', 'writerOverride')}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <Info className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t('planGeneration', 'writerOverrideTooltip')}
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              rows={2}
              placeholder={t('planGeneration', 'writerOverridePlaceholder')}
              value={globalOverride}
              onChange={(e) => setGlobalOverride(e.target.value)}
              onBlur={() => update.mutate({ writer_prompt_override: globalOverride })}
            />
          </div>
        </div>
      )}
      <div className="flex h-full overflow-hidden">
        <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
          {sections.map((s, i) => {
            const worstFlag = s.groundedness_flags?.reduce<'high' | 'medium' | 'low' | null>(
              (acc, f) => (acc === 'high' ? acc : f.risk === 'high' ? 'high' : acc === 'medium' ? acc : f.risk === 'medium' ? 'medium' : 'low'),
              null,
            ) ?? null;
            return (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between gap-1',
                  i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted',
                )}
              >
                <span className="truncate flex-1">
                  {i + 1}. {s.title}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {worstFlag === 'high' && <span className="h-2 w-2 rounded-full bg-destructive" title="Hallucination risk: high" />}
                  {worstFlag === 'medium' && <span className="h-2 w-2 rounded-full bg-amber-500" title="Hallucination risk: medium" />}
                  {worstFlag === 'low' && <span className="h-2 w-2 rounded-full bg-yellow-400" title="Hallucination risk: low" />}
                  {s.generated_markdown && !worstFlag && <span className="text-primary text-xs">✓</span>}
                </span>
              </button>
            );
          })}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {!active ? (
            <p className="text-muted-foreground">No sections.</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{active.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {active.description}
                </p>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('planGeneration', 'sectionInstructions')}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {t('planGeneration', 'sectionInstructionsTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Textarea
                    rows={2}
                    placeholder={t('planGeneration', 'sectionInstructionsPlaceholder')}
                    value={sectionInstructions}
                    onChange={(e) => saveSectionInstructions(active, e.target.value)}
                  />
                </div>

                {active.selected.length === 0 && (
                  <p className="text-amber-600 text-sm">
                    No fragments approved — output may be weak.
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={() => generateOne(active.id)}
                  disabled={generate.isPending}
                >
                  {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {active.generated_markdown
                    ? t('planGeneration', 'regenerate')
                    : t('planGeneration', 'generateSection')}
                </Button>
                <div className="relative">
                  <button
                    onClick={() => copyToClipboard(activeMarkdown, setCopiedSection)}
                    className="absolute top-2 right-2 z-10 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Copier"
                  >
                    {copiedSection ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <Textarea
                    rows={18}
                    className="font-mono text-sm pr-8"
                    value={activeMarkdown}
                    onChange={(e) => saveSectionMarkdown(active, e.target.value)}
                  />
                </div>
                <GroundednessPanel flags={active.groundedness_flags} />
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
