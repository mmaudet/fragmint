import { useState } from 'react';
import type { Plan, PlanSection } from '@/api/types';
import { useGenerateSection, useUpdatePlan, useAssemble } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function DraftsStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [override, setOverride] = useState(plan.state.writer_prompt_override ?? '');
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const update = useUpdatePlan(plan.id);
  const generate = useGenerateSection(plan.id);
  const assemble = useAssemble(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];

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
      setProgress({ i, total: sections.length });
      try {
        await generate.mutateAsync(sections[i].id);
      } catch (e: any) {
        toast.error(`Failed on section "${sections[i].title}": ${e.message ?? e}`);
        break;
      }
    }
    setProgress(null);
  }

  function saveSectionMarkdown(s: PlanSection, md: string) {
    update.mutate({
      sections: sections.map((x) => (x.id === s.id ? { ...x, generated_markdown: md } : x)),
    });
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActiveIdx(i)}
            className={
              'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ' +
              (i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted')
            }
          >
            <span className="truncate">{i + 1}. {s.title}</span>
            {s.generated_markdown && <span className="text-primary text-xs">✓</span>}
          </button>
        ))}
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="border-b p-4 space-y-3">
          <details>
            <summary className="text-sm cursor-pointer">{t('planGeneration', 'writerOverride')}</summary>
            <Textarea
              rows={4}
              className="mt-2"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              onBlur={() => update.mutate({ writer_prompt_override: override })}
            />
          </details>
          <div className="flex items-center gap-3">
            <Button onClick={generateAll} disabled={progress !== null}>
              {progress
                ? `Generating section ${progress.i + 1} / ${progress.total}…`
                : t('planGeneration', 'generateAllSections')}
            </Button>
            <Button variant="outline" onClick={() => assemble.mutate()}>
              {t('planGeneration', 'assemble')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!active ? (
            <p className="text-muted-foreground">No sections.</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{active.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{active.description}</p>
                {active.selected.length === 0 && (
                  <p className="text-amber-600 text-sm">No fragments approved — output may be weak.</p>
                )}
                <Button size="sm" onClick={() => generateOne(active.id)} disabled={generate.isPending}>
                  {active.generated_markdown
                    ? t('planGeneration', 'regenerate')
                    : t('planGeneration', 'generatePlan')}
                </Button>
                <Textarea
                  rows={18}
                  className="font-mono text-sm"
                  value={active.generated_markdown ?? ''}
                  onChange={(e) => saveSectionMarkdown(active, e.target.value)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
