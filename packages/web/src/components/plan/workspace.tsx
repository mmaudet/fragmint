import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlan, useUpdatePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { X, Info, Lock, ArrowLeft } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { SpecStep } from './spec-step';
import { FragmentsStep } from './fragments-step';
import { DraftsStep } from './drafts-step';
import { ExportStep } from './export-step';
import type { PlanStatus } from '@/api/types';

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const;
const HELP_DISMISS_PREFIX = 'fragmint.plan-step-help.dismissed.';

function isStepUnlocked(stepIdx: number, status: PlanStatus): boolean {
  switch (stepIdx) {
    case 0:
      return true;
    case 1:
      return status !== 'draft';
    case 2:
    case 3:
      return status === 'fragments_validated' || status === 'completed';
    default:
      return false;
  }
}

function defaultStepFromStatus(status: PlanStatus | undefined): number {
  switch (status) {
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

function readDismissed(stepIdx: number): boolean {
  try {
    return localStorage.getItem(`${HELP_DISMISS_PREFIX}${stepIdx}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(stepIdx: number) {
  try {
    localStorage.setItem(`${HELP_DISMISS_PREFIX}${stepIdx}`, '1');
  } catch {
    /* ignore */
  }
}

export function Workspace({ planId }: { planId: string }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { data: plan, isLoading } = usePlan(planId);
  const [step, setStep] = useState<number | null>(null);
  const [, forceRender] = useState(0);
  const [globalOverride, setGlobalOverride] = useState(plan?.state.writer_prompt_override ?? '');
  const update = useUpdatePlan(planId);

  if (isLoading || !plan) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const status = plan.status as PlanStatus;
  const activeStep = step ?? defaultStepFromStatus(status);
  const helpKey = STEP_KEYS[activeStep];
  const helpDismissed = readDismissed(activeStep);

  function dismissHelp() {
    writeDismissed(activeStep);
    forceRender((n) => n + 1);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4 flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => nav('/plan-generation')}
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

      {!helpDismissed && (
        <div className="border-b bg-muted/40 px-4 py-3 space-y-3">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="flex-1 text-sm text-muted-foreground leading-relaxed">
              {t('planGeneration', `${helpKey}Help` as 'step1Help')}
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
          {activeStep === 2 && (
            <div className="pl-7 space-y-1">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                {t('planGeneration', 'writerOverride')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help"><Info className="h-3 w-3" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t('planGeneration', 'writerOverrideTooltip')}</TooltipContent>
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
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {activeStep === 0 && <SpecStep plan={plan} />}
        {activeStep === 1 && <FragmentsStep plan={plan} />}
        {activeStep === 2 && <DraftsStep plan={plan} />}
        {activeStep === 3 && <ExportStep plan={plan} />}
      </div>
    </div>
  );
}
