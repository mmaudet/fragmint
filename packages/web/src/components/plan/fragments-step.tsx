import { useState } from 'react';
import type { Plan, PlanSection, SectionFragmentSelection } from '@/api/types';
import { useSectionSearch, useUpdatePlan, useValidateFragments } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SectionFragmentCard } from './section-fragment-card';
import { AddFragmentDialog } from './add-fragment-dialog';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function FragmentsStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const update = useUpdatePlan(plan.id);
  const search = useSectionSearch(plan.id);
  const validate = useValidateFragments(plan.id);

  const sections = plan.state.sections;
  const active = sections[activeIdx];

  function updateSection(sectionId: string, fn: (s: PlanSection) => PlanSection) {
    const next = sections.map((s) => (s.id === sectionId ? fn(s) : s));
    update.mutate({ sections: next });
  }

  function applySelectionChange(
    section: PlanSection,
    candidateId: string,
    sel: SectionFragmentSelection | null,
  ) {
    const next: PlanSection = {
      ...section,
      selected: sel
        ? [...section.selected.filter((s) => s.fragment_id !== candidateId), sel]
        : section.selected.filter((s) => s.fragment_id !== candidateId),
    };
    updateSection(section.id, () => next);
  }

  function applyCandidateReject(section: PlanSection, candidateId: string) {
    const next: PlanSection = {
      ...section,
      candidates: section.candidates.filter((c) => c.fragment_id !== candidateId),
      selected: section.selected.filter((s) => s.fragment_id !== candidateId),
    };
    updateSection(section.id, () => next);
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
        {sections.map((s, i) => {
          const reviewed = s.selected.length > 0;
          return (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between',
                i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted',
              )}
            >
              <span className="truncate">{i + 1}. {s.title}</span>
              {reviewed && <span className="text-primary text-xs">✓</span>}
            </button>
          );
        })}
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {!active ? (
            <p className="text-muted-foreground">No sections.</p>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{active.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{active.description}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => search.mutate({ sectionId: active.id })}
                      disabled={search.isPending}
                    >
                      {search.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      {t('planGeneration', 'reSearch')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      {t('planGeneration', 'addFragment')}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {active.candidates.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t('planGeneration', 'noCandidates')}
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                  {active.candidates.map((c) => (
                    <SectionFragmentCard
                      key={c.fragment_id}
                      candidate={c}
                      selection={active.selected.find((s) => s.fragment_id === c.fragment_id)}
                      onChange={(sel) => applySelectionChange(active, c.fragment_id, sel)}
                      onReject={() => applyCandidateReject(active, c.fragment_id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t p-3 flex justify-end">
          <Button
            onClick={async () => {
              try {
                await validate.mutateAsync();
              } catch (e: any) {
                toast.error(`Validation failed: ${e.message ?? e}`);
              }
            }}
            disabled={validate.isPending}
          >
            {t('planGeneration', 'validateAllSections')}
          </Button>
        </div>
      </main>

      {active && (
        <AddFragmentDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          planId={plan.id}
          sectionId={active.id}
        />
      )}
    </div>
  );
}
