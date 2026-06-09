import { useState } from 'react';
import type { Plan, PlanSection, SectionFragmentSelection } from '@/api/types';
import { useUpdatePlan, useValidateFragments } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { SectionFragmentCard } from './section-fragment-card';
import { AddFragmentDialog } from './add-fragment-dialog';
import { useFragmentCollections } from '@/api/hooks/use-plans';
import { Plus, Loader2, AlertTriangle, Info, Table2, Trash2, ExternalLink, CheckCircle2, X } from 'lucide-react';
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

const HELP_DISMISS_KEY = 'fragmint.plan-step-help.dismissed.1';

function readDismissed() {
  try { return localStorage.getItem(HELP_DISMISS_KEY) === '1'; } catch { return false; }
}
function writeDismissed() {
  try { localStorage.setItem(HELP_DISMISS_KEY, '1'); } catch { /* ignore */ }
}

export function FragmentsStep({ plan, onValidated, isSearching, onSearchAll }: { plan: Plan; onValidated?: () => void; isSearching?: boolean; onSearchAll?: () => void }) {
  const { t, lang } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [helpDismissed, setHelpDismissed] = useState(readDismissed);
  const update = useUpdatePlan(plan.id);

  function dismissHelp() { writeDismissed(); setHelpDismissed(true); }

  function approveAllGlobal() {
    const newSections = plan.state.sections.map((s) => {
      const newSelections: SectionFragmentSelection[] = s.candidates.map((c) => ({
        fragment_id: c.fragment_id,
        body: c.body_excerpt ?? '',
        edited: false,
        propose_to_library: false,
      }));
      const existingOther = s.selected.filter(
        (sel) => !s.candidates.some((c) => c.fragment_id === sel.fragment_id),
      );
      return { ...s, selected: [...existingOther, ...newSelections] };
    });
    update.mutate({ sections: newSections });
  }

  function rejectAllGlobal() {
    update.mutate({ sections: plan.state.sections.map((s) => ({ ...s, candidates: [], selected: [] })) });
  }
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

  // True when a bulk search is running and this section hasn't returned results yet.
  // Prevents "Aucun fragment trouvé" from flashing before the search completes.
  const activePending = !!isSearching && (active?.candidates?.length ?? 0) === 0;

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

  function approveAllCandidates(section: PlanSection) {
    const newSelections: SectionFragmentSelection[] = section.candidates.map((c) => ({
      fragment_id: c.fragment_id,
      body: c.body_excerpt ?? '',
      edited: false,
      propose_to_library: false,
    }));
    const existingOther = section.selected.filter(
      (s) => !section.candidates.some((c) => c.fragment_id === s.fragment_id),
    );
    updateSection(section.id, (s) => ({ ...s, selected: [...existingOther, ...newSelections] }));
  }

  function rejectAllCandidates(section: PlanSection) {
    updateSection(section.id, (s) => ({ ...s, candidates: [], selected: [] }));
  }

  return (
    <div className="flex flex-col">
      {!helpDismissed && (
        <div className="border-b bg-muted/40 px-4 py-3 space-y-3 shrink-0">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="flex-1 text-sm text-muted-foreground leading-relaxed">
              {t('planGeneration', 'step2Help')}
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
          <div className="pl-7 space-y-3">
            <div className="text-xs text-muted-foreground border rounded-md px-3 py-2.5 bg-muted/40 space-y-1">
              <p className="font-medium text-foreground">{t('planGeneration', 'matchLegendTitle')}</p>
              <p><span className="font-medium">{t('planGeneration', 'confidenceHigh')}</span> — {t('planGeneration', 'matchLegendStrong')}</p>
              <p><span className="font-medium">{t('planGeneration', 'confidenceMedium')}</span> — {t('planGeneration', 'matchLegendMedium')}</p>
              <p><span className="font-medium">{t('planGeneration', 'confidenceLow')}</span> — {t('planGeneration', 'matchLegendWeak')}</p>
              <p><span className="font-medium">{t('planGeneration', 'confidenceUnknown')}</span> — {t('planGeneration', 'matchLegendUnscored')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onSearchAll} disabled={isSearching}>
                {isSearching && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {t('planGeneration', 'searchAllSections')}
                {isSearching && (
                  <span className="ml-1.5 text-xs opacity-60">
                    {sections.filter(s => (s.candidates?.length ?? 0) > 0).length} / {sections.length}
                  </span>
                )}
              </Button>
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-primary border-primary/40 hover:bg-primary/10"
                  onClick={approveAllGlobal}
                  disabled={update.isPending}
                >
                  {t('planGeneration', 'approveAllSections')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={rejectAllGlobal}
                  disabled={update.isPending}
                >
                  {t('planGeneration', 'rejectAllSections')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex h-[calc(100vh-4rem)] min-h-0">
      <aside className="w-64 border-r overflow-y-auto p-3 space-y-1">
        {sections.map((s, i) => {
          const reviewed = s.selected.length > 0;
          const hasCandidates = (s.candidates?.length ?? 0) > 0;
          const pending = isSearching && !hasCandidates;
          const done = isSearching && hasCandidates;
          return (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-1.5',
                i === activeIdx ? 'bg-primary/15' : 'hover:bg-muted',
              )}
            >
              <span className="truncate flex-1 min-w-0">
                {i + 1}. {s.title}
              </span>
              {pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/60" />}
              {done && !reviewed && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500/70" />}
              {!isSearching && !reviewed && hasCandidates && (
                <span className="text-[10px] text-muted-foreground/60 shrink-0">{s.candidates.length}</span>
              )}
              {reviewed && <span className="text-primary text-xs shrink-0">✓</span>}
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

                  <div className="flex gap-2 flex-wrap items-center">
                    <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      {t('planGeneration', 'addFragment')}
                    </Button>
                    {active.candidates.length > 0 && (
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-primary border-primary/40 hover:bg-primary/10"
                          onClick={() => approveAllCandidates(active)}
                        >
                          {t('planGeneration', 'approveAll')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => rejectAllCandidates(active)}
                        >
                          {t('planGeneration', 'rejectAll')}
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {sectionConfidence === 'empty' && !activePending && (
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
              {activePending && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{lang === 'fr' ? 'Recherche en cours…' : 'Searching…'}</span>
                </div>
              )}
              {active.candidates.length === 0 && !active.table_source?.collection_id && !activePending && (
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
      </div>

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
