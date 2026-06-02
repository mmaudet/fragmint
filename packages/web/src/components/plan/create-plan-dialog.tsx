import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePlan } from '@/api/hooks/use-plans';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function CreatePlanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [specPrompt, setSpecPrompt] = useState('');
  const create = useCreatePlan();
  const nav = useNavigate();
  const { t } = useI18n();

  async function handleSubmit() {
    const plan = await create.mutateAsync({ title: title || undefined, spec_prompt: specPrompt });
    onOpenChange(false);
    setTitle('');
    setSpecPrompt('');
    nav(`/plans?id=${plan.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'newPlan')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder={t('planGeneration', 'specPrompt')}
            rows={8}
            value={specPrompt}
            onChange={(e) => setSpecPrompt(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {t('planGeneration', 'newPlan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
