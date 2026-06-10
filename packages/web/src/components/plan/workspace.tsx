import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan, useSearchAllSections, useUpdatePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Lock, ArrowLeft } from 'lucide-react';
import { SpecStep } from './spec-step';
import { FragmentsStep } from './fragments-step';
import { DraftsStep } from './drafts-step';
import { ExportStep } from './export-step';
import type { PlanStatus } from '@/api/types';

// Regular plans: 4 steps (Specs=0, Fragments=1, Drafts=2, Export=3)
// Template plans: 3 steps (Fragments=1, Drafts=2, Export=3) — step 0 hidden
const STEP_KEYS_ALL  = ['step1', 'step2', 'step3', 'step4'] as const;
const STEP_KEYS_TPL  = ['step2', 'step3', 'step4'] as const;

function isStepUnlocked(stepIdx: number, status: PlanStatus, isTemplate: boolean): boolean {
  if (isTemplate) {
    // template nav indices: 0=Fragments, 1=Drafts, 2=Export
    switch (stepIdx) {
      case 0: return true;
      case 1:
      case 2: return status === 'fragments_validated' || status === 'completed';
      default: return false;
    }
  }
  switch (stepIdx) {
    case 0: return true;
    case 1: return status === 'plan_generated' || status === 'plan_validated' || status === 'fragments_validated' || status === 'completed';
    case 2:
    case 3: return status === 'fragments_validated' || status === 'completed';
    default: return false;
  }
}

function defaultStepFromStatus(status: PlanStatus | undefined, isTemplate: boolean): number {
  if (isTemplate) return 0; // always start at Fragments for template plans
  switch (status) {
    case 'plan_generated': return 0;
    case 'plan_validated':  return 1;
    case 'fragments_validated': return 2;
    case 'completed':       return 3;
    default:                return 0;
  }
}

export function Workspace({ planId }: { planId: string }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const searchAll = useSearchAllSections(planId);
  const { data: plan, isLoading } = usePlan(planId, {
    refetchInterval: searchAll.isPending ? 1500 : false,
  });
  const [step, setStep] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const updatePlan = useUpdatePlan(planId);

  if (isLoading || !plan) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const status = plan.status as PlanStatus;
  const isTemplate = !!plan.state.from_template_id;
  const stepKeys = isTemplate ? STEP_KEYS_TPL : STEP_KEYS_ALL;
  const activeStep = step ?? defaultStepFromStatus(status, isTemplate);

  function startEditTitle() {
    setTitleDraft(plan!.title ?? '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== plan!.title) {
      updatePlan.mutate({ title: trimmed });
    }
    setEditingTitle(false);
  }

  // For template plans, nav index 0 = internal step 1, 1 = step 2, 2 = step 3
  const navToInternal = (navIdx: number) => isTemplate ? navIdx + 1 : navIdx;
  const internalToNav = (internal: number) => isTemplate ? internal - 1 : internal;

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-background border-b p-4 flex items-center gap-4 h-16 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => nav('/plans')}
          className="flex-shrink-0 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            className="text-xl font-semibold bg-transparent border-b border-ring outline-none flex-shrink-0 min-w-0 max-w-sm"
          />
        ) : (
          <h2
            className="text-xl font-semibold flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
            onClick={startEditTitle}
            title="Cliquer pour renommer"
          >
            {plan.title}
          </h2>
        )}
        <nav className="flex items-center gap-2 overflow-x-auto">
          {stepKeys.map((key, navIdx) => {
            const unlocked = isStepUnlocked(navIdx, status, isTemplate);
            const label = t('planGeneration', `${key}Label` as 'step1Label');
            const isActive = activeStep === (isTemplate ? navIdx : navIdx);
            return (
              <Button
                key={navIdx}
                size="sm"
                variant={isActive ? 'default' : 'ghost'}
                onClick={() => unlocked && setStep(isTemplate ? navIdx : navIdx)}
                disabled={!unlocked}
                title={unlocked ? undefined : t('planGeneration', 'stepLocked')}
                className={cn('text-xs whitespace-nowrap', !unlocked && 'opacity-50')}
              >
                {!unlocked && <Lock className="h-3 w-3 mr-1" />}
                {navIdx + 1}. {label}
              </Button>
            );
          })}
        </nav>
        {isTemplate ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0 ml-auto">
            {plan.state.from_template_name ?? t('planGeneration', 'templateLabel')}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 flex-shrink-0 ml-auto">
            Brief
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {!isTemplate && activeStep === 0 && <SpecStep plan={plan} onValidated={() => { setStep(1); searchAll.mutate(); }} />}
        {(isTemplate ? activeStep === 0 : activeStep === 1) && (
          <FragmentsStep
            plan={plan}
            onValidated={() => setStep(isTemplate ? 1 : 2)}
            isSearching={searchAll.isPending}
            onSearchAll={() => searchAll.mutate()}
          />
        )}
        {(isTemplate ? activeStep === 1 : activeStep === 2) && (
          <DraftsStep plan={plan} onAssembled={() => setStep(isTemplate ? 2 : 3)} />
        )}
        {(isTemplate ? activeStep === 2 : activeStep === 3) && <ExportStep plan={plan} />}
      </div>
    </div>
  );
}
