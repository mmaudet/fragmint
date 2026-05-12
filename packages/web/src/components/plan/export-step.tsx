import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/api/types';
import { useAssemble, useUpdatePlan, exportPlan } from '@/api/hooks/use-plans';
import { useStyleTemplates } from '@/api/hooks/use-style-templates';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { UploadStyleTemplateDialog } from './upload-style-template-dialog';
import { toast } from 'sonner';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const update = useUpdatePlan(plan.id);
  const assemble = useAssemble(plan.id);
  const styleTemplates = useStyleTemplates();
  const [draft, setDraft] = useState(plan.state.draft_markdown ?? '');
  const [uploadOpen, setUploadOpen] = useState(false);
  const styleId = plan.state.export_style_template_id ?? '';
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  async function handleReassemble() {
    if (plan.state.draft_dirty && !confirm('This will overwrite your manual edits. Continue?')) return;
    try {
      const out = await assemble.mutateAsync();
      setDraft(out.state.draft_markdown ?? '');
    } catch (e: any) {
      toast.error(`Assemble failed: ${e.message ?? e}`);
    }
  }

  async function handleExport(format: 'md' | 'docx') {
    try {
      const blob = await exportPlan(plan.id, format, styleId || undefined);
      const ext = format === 'md' ? 'md' : 'docx';
      downloadBlob(blob, `${plan.title || 'plan'}.${ext}`);
    } catch (e: any) {
      toast.error(`Export failed: ${e.message ?? e}`);
    }
  }

  function onDraftChange(v: string) {
    setDraft(v);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      update.mutate({ draft_markdown: v, draft_dirty: true });
    }, 500);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" onClick={handleReassemble}>{t('planGeneration', 'assemble')}</Button>
        <Button onClick={() => handleExport('md')}>{t('planGeneration', 'downloadMd')}</Button>

        <Select
          value={styleId || '__none__'}
          onValueChange={(v) => update.mutate({ export_style_template_id: v === '__none__' ? null : v })}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('planGeneration', 'styleTemplate')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t('planGeneration', 'defaultStyling')}</SelectItem>
            {(styleTemplates.data ?? []).map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
          + {t('planGeneration', 'uploadStyleTemplate')}
        </Button>
        <Button onClick={() => handleExport('docx')}>{t('planGeneration', 'downloadDocx')}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Final markdown</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={32}
            className="font-mono text-sm"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
          />
        </CardContent>
      </Card>

      <UploadStyleTemplateDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(id) => update.mutate({ export_style_template_id: id })}
      />
    </div>
  );
}
