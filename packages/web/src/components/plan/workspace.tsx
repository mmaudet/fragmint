import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan, useSearchAllSections } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Lock, ArrowLeft } from 'lucide-react';
import { SpecStep } from './spec-step';
import { FragmentsStep } from './fragments-step';
import { DraftsStep } from './drafts-step';
import { ExportStep } from './export-step';
import type { PlanStatus } from '@/api/types';

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const;

function isStepUnlocked(stepIdx: number, status: PlanStatus): boolean {
  switch (stepIdx) {
    case 0:
      return true;
    case 1:
      return status === 'plan_validated' || status === 'fragments_validated' || status === 'completed';
    case 2:
    case 3:
      return status === 'fragments_validated' || status === 'completed';
    default:
      return false;
  }
}

function defaultStepFromStatus(status: PlanStatus | undefined): number {
  switch (status) {
    case 'plan_generated':
      return 0;
    case 'plan_validated':
      return 1;
    case 'fragments_validated':
      return 2;
    case 'completed':
      return 3;
    default:
      return 0;
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

  if (isLoading || !plan) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const status = plan.status as PlanStatus;
  const activeStep = step ?? defaultStepFromStatus(status);

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
        <h2 className="text-xl font-semibold flex-shrink-0">{plan.title}</h2>
        <nav className="flex items-center gap-2 overflow-x-auto">
          {STEP_KEYS.map((key, i) => {
            const unlocked = isStepUnlocked(i, status);
            const label = t('planGeneration', `${key}Label` as 'step1Label');
            return (
              <Button
                key={i}
                size="sm"
                variant={i === activeStep ? 'default' : 'ghost'}
                onClick={() => unlocked && setStep(i)}
                disabled={!unlocked}
                title={unlocked ? undefined : t('planGeneration', 'stepLocked')}
                className={cn('text-xs whitespace-nowrap', !unlocked && 'opacity-50')}
              >
                {!unlocked && <Lock className="h-3 w-3 mr-1" />}
                {i + 1}. {label}
              </Button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto">
        {activeStep === 0 && <SpecStep plan={plan} onValidated={() => { setStep(1); searchAll.mutate(); }} />}
        {activeStep === 1 && (
          <FragmentsStep
            plan={plan}
            onValidated={() => setStep(2)}
            isSearching={searchAll.isPending}
            onSearchAll={() => searchAll.mutate()}
          />
        )}
        {activeStep === 2 && <DraftsStep plan={plan} onAssembled={() => setStep(3)} />}
        {activeStep === 3 && <ExportStep plan={plan} />}
      </div>
    </div>
  );
}
