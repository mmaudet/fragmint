import { useState } from 'react';
import { usePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SpecStep } from './spec-step';
import { FragmentsStep } from './fragments-step';
import { DraftsStep } from './drafts-step';
import { ExportStep } from './export-step';

const STEPS = ['Spec & Plan', 'Section fragments', 'Section drafts', 'Assemble & Export'];

function defaultStepFromStatus(status: string | undefined): number {
  switch (status) {
    case 'plan_validated': return 1;
    case 'fragments_validated': return 2;
    case 'completed': return 3;
    default: return 0;
  }
}

export function Workspace({ planId }: { planId: string }) {
  const { data: plan, isLoading } = usePlan(planId);
  const [step, setStep] = useState<number | null>(null);

  if (isLoading || !plan) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const activeStep = step ?? defaultStepFromStatus(plan.status);

  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4 flex items-center gap-4">
        <h2 className="text-xl font-semibold flex-shrink-0">{plan.title}</h2>
        <nav className="flex items-center gap-2 overflow-x-auto">
          {STEPS.map((label, i) => (
            <Button
              key={i}
              size="sm"
              variant={i === activeStep ? 'default' : 'ghost'}
              onClick={() => setStep(i)}
              className={cn('text-xs whitespace-nowrap')}
            >
              {i + 1}. {label}
            </Button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto">
        {activeStep === 0 && <SpecStep plan={plan} />}
        {activeStep === 1 && <FragmentsStep plan={plan} />}
        {activeStep === 2 && <DraftsStep plan={plan} />}
        {activeStep === 3 && <ExportStep plan={plan} />}
      </div>
    </div>
  );
}
