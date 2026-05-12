import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlanList } from '@/components/plan/plan-list';
import { CreatePlanDialog } from '@/components/plan/create-plan-dialog';
import { Workspace } from '@/components/plan/workspace';

export default function PlanGenerationPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [createOpen, setCreateOpen] = useState(false);

  if (id) return <Workspace planId={id} />;

  return (
    <>
      <PlanList onCreate={() => setCreateOpen(true)} />
      <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
