import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePlan, usePlanTemplates } from '@/api/hooks/use-plans';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';

export function CreatePlanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [mode, setMode] = useState<'brief' | 'template'>('brief');
  const [title, setTitle] = useState('');
  const [specPrompt, setSpecPrompt] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const create = useCreatePlan();
  const templates = usePlanTemplates('active');
  const nav = useNavigate();
  const { t } = useI18n();

  function handleOpenChange(v: boolean) {
    if (!v) {
      setMode('brief');
      setTitle('');
      setSpecPrompt('');
      setSelectedTemplateId('');
    }
    onOpenChange(v);
  }

  async function handleSubmit() {
    const input =
      mode === 'template'
        ? { title: title || undefined, template_id: selectedTemplateId }
        : { title: title || undefined, spec_prompt: specPrompt };
    const plan = await create.mutateAsync(input);
    handleOpenChange(false);
    nav(`/plans?id=${plan.id}`);
  }

  const canSubmit =
    mode === 'brief' ? specPrompt.trim().length > 0 : selectedTemplateId.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'newPlan')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setMode('brief')}
              className={`flex-1 px-3 py-1.5 transition-colors ${
                mode === 'brief'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              {t('planGeneration', 'fromBrief')}
            </button>
            <button
              type="button"
              onClick={() => setMode('template')}
              className={`flex-1 px-3 py-1.5 transition-colors ${
                mode === 'template'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              {t('planGeneration', 'fromTemplate')}
            </button>
          </div>
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {mode === 'brief' ? (
            <Textarea
              placeholder={t('planGeneration', 'specPrompt')}
              rows={8}
              value={specPrompt}
              onChange={(e) => setSpecPrompt(e.target.value)}
            />
          ) : (
            <div>
              {templates.isPending ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('planGeneration', 'selectTemplate')}…
                </p>
              ) : !templates.data || templates.data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('planGeneration', 'noTemplates')}
                </p>
              ) : (
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('planGeneration', 'selectTemplate')} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="w-[--radix-select-trigger-width]">
                    {templates.data.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        <span>{tpl.name}</span>
                        {tpl.description && (
                          <span className="ml-2 text-muted-foreground text-xs">
                            — {tpl.description}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={create.isPending || !canSubmit}>
            {mode === 'template'
              ? t('planGeneration', 'createFromTemplate')
              : t('planGeneration', 'generatePlan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
