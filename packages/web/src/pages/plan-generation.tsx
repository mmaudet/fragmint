import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlanList } from '@/components/plan/plan-list';
import { CreatePlanDialog } from '@/components/plan/create-plan-dialog';

export default function PlanGenerationPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [createOpen, setCreateOpen] = useState(false);

  if (!id) {
    return (
      <>
        <PlanList onCreate={() => setCreateOpen(true)} />
        <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <div className="p-6">
      <p className="text-muted-foreground">Workspace stub for plan {id} — implemented in next tasks.</p>
    </div>
  );
}
