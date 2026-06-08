import { useState } from 'react';
import type { Plan, PlanSection, SectionFragmentSelection } from '@/api/types';
import { useSectionSearch, useUpdatePlan, useValidateFragments } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SectionFragmentCard } from './section-fragment-card';
import { AddFragmentDialog } from './add-fragment-dialog';
import { useFragmentCollections } from '@/api/hooks/use-plans';
import { Plus, Loader2, AlertTriangle, Info, Table2, Trash2, ExternalLink } from 'lucide-react';
import type { FragmentCollection } from '@/api/types';
import { toast } from 'sonner';

function CollectionCard({ collection, onDetach }: { collection: FragmentCollection; onDetach: () => void }) {
  return (
    <Card className="border-teal-500/50 bg-teal-500/10 flex flex-col h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <Table2 className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <CardTitle className="text-sm leading-snug">{collection.title}</CardTitle>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-teal-500/15 text-teal-700 dark:text-teal-300 shrink-0">
            📊 Tableau
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 gap-2">
        <p className="text-xs text-muted-foreground">
          {collection.member_ids.length} ligne{collection.member_ids.length > 1 ? 's' : ''} de tableau
          {collection.source_document && ` · ${collection.source_document}`}
        </p>
        <div className="flex-1" />
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={onDetach} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4 mr-1" />
            Détacher
          </Button>
          <a
            href="/ui/admin/fragments?view=tableaux"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Voir le tableau
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export function FragmentsStep({ plan, onValidated }: { plan: Plan; onValidated?: () => void }) {
  const { t, lang } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const update = useUpdatePlan(plan.id);
  const search = useSectionSearch(plan.id);
  const validate = useValidateFragments(plan.id);
  const { data: collections = [] } = useFragmentCollections();
  const collectionsById = Object.fromEntries(collections.map((c) => [c.id, c]));

  const sections = plan.state.sections;
  const active = sections[activeIdx];

  // Derive section confidence from candidate confidence_level values (computed locally,
  // not persisted, so always fresh regardless of when the plan was generated).
  const sectionConfidence: 'good' | 'partial' | 'poor' | 'empty' | null = active == null ? null
    : active.candidates.length === 0 ? 'empty'
    : active.candidates.some(c => c.confidence_level === 'high') ? 'good'
    : active.candidates.some(c => c.confidence_level === 'medium') ? 'partial'
    : 'poor';

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
              <span className="truncate">
                {i + 1}. {s.title}
              </span>
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
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {active.description}
                  </p>

                  <div className="flex gap-2 flex-wrap pt-1 border-t">
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

              {sectionConfidence === 'empty' && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-muted border border-border px-3 py-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{t('planGeneration', 'sectionConfidenceEmpty')}</span>
                </div>
              )}
              {sectionConfidence === 'poor' && active.candidates.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{t('planGeneration', 'sectionConfidencePoor')}</span>
                </div>
              )}
              {sectionConfidence === 'partial' && active.candidates.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{t('planGeneration', 'sectionConfidencePartial')}</span>
                </div>
              )}
              {active.candidates.length > 0 && active.section_confidence === 'partial' && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    {lang === 'fr'
                      ? `${active.candidates.length} fragment${active.candidates.length > 1 ? 's' : ''} pertinent${active.candidates.length > 1 ? 's' : ''} trouvé${active.candidates.length > 1 ? 's' : ''}. Le système n'a pas trouvé d'autres fragments suffisamment pertinents pour cette section.`
                      : `${active.candidates.length} relevant fragment${active.candidates.length > 1 ? 's' : ''} found. The system did not find enough relevant fragments for this section.`}
                  </span>
                </div>
              )}
              {active.candidates.length === 0 && !active.table_source?.collection_id && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t('planGeneration', 'noCandidates')}
                </p>
              )}
              {(active.candidates.length > 0 || active.table_source?.collection_id) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                  {active.table_source?.collection_id && collectionsById[active.table_source.collection_id] && (
                    <CollectionCard
                      collection={collectionsById[active.table_source.collection_id]}
                      onDetach={() => updateSection(active.id, (s) => ({ ...s, table_source: undefined }))}
                    />
                  )}
                  {active.candidates.map((c) => (
                    <SectionFragmentCard
                      key={`${active.id}-${c.fragment_id}`}
                      candidate={c}
                      collectionSlug={plan.collection_slug ?? 'common'}
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
                onValidated?.();
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
          onAttachCollection={(collectionId) =>
            updateSection(active.id, (s) => ({ ...s, table_source: { collection_id: collectionId } }))
          }
        />
      )}
    </div>
  );
}
