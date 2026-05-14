import { useEffect, useRef, useState } from 'react';
import type { Plan, PlanSection } from '@/api/types';
import { useGenerateSection, useUpdatePlan, useAssemble } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Loader2, Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function DraftsStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const update = useUpdatePlan(plan.id);
  const generate = useGenerateSection(plan.id);
  const assemble = useAssemble(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];

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
    <div className="flex flex-col h-full">
      <div className="border-b p-3 flex items-center gap-3">
        <Button onClick={generateAll} disabled={progress !== null}>
          {progress && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {progress
            ? `${progress.i} / ${progress.total} ✓`
            : t('planGeneration', 'generateAllSections')}
        </Button>
        <Button variant="outline" onClick={() => assemble.mutate()} disabled={assemble.isPending}>
          {assemble.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('planGeneration', 'assemble')}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
          {sections.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between',
                i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted',
              )}
            >
              <span className="truncate">{i + 1}. {s.title}</span>
              {s.generated_markdown && <span className="text-primary text-xs">✓</span>}
            </button>
          ))}
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
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{active.description}</p>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('planGeneration', 'sectionInstructions')}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help"><Info className="h-3 w-3 text-muted-foreground" /></span>
                      </TooltipTrigger>
                      <TooltipContent side="right">{t('planGeneration', 'sectionInstructionsTooltip')}</TooltipContent>
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
                  <p className="text-amber-600 text-sm">No fragments approved — output may be weak.</p>
                )}
                <Button size="sm" onClick={() => generateOne(active.id)} disabled={generate.isPending}>
                  {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {active.generated_markdown
                    ? t('planGeneration', 'regenerate')
                    : t('planGeneration', 'generateSection')}
                </Button>
                <Textarea
                  rows={18}
                  className="font-mono text-sm"
                  value={activeMarkdown}
                  onChange={(e) => saveSectionMarkdown(active, e.target.value)}
                />
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
